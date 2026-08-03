/**
 * Cloud sync — orchestration.
 *
 * One pass: read what the server has, decide each document's direction with
 * `sync.ts` (pure), move the bytes with `supabaseClient.ts` (network), and
 * stamp what landed. Nothing here decides a merge rule and nothing here holds
 * app state — the store hands in a small set of ports and gets called back.
 *
 * Two rules the whole file is built around:
 *
 * 1. **A sync never destroys a game.** The one document where both sides can
 *    hold real, different play is the active game, and that is the one case
 *    that asks. Whichever copy loses is written to a save slot first, so the
 *    wrong answer is a restore away rather than a loss.
 * 2. **A stamp is written only after the bytes land.** A crash mid-pass leaves
 *    a key looking dirty, which costs one redundant transfer next time. The
 *    opposite order would mark a document synced that never left the device.
 */

import type { GameState, Settings } from "../types";
import {
  clearSyncStamps,
  deleteImageStamp,
  deleteSlot,
  deviceId,
  listImageKeys,
  listSlotIds,
  loadImage,
  readActiveGame,
  readDocStamps,
  readImageStamps,
  readSlot,
  readSyncAccount,
  saveImage,
  saveSlot,
  writeDocStamp,
  writeImageStamp,
  writeSyncAccount,
  type SaveSlot,
} from "./db";
import { loadGame } from "./defaults";
import { onLocalWrite } from "./dirty";
import { backoffMs, MAX_ATTEMPTS } from "./retry";
import {
  ACTIVE_DOC,
  LEGACY_CHARACTERS_DOC,
  SETTINGS_DOC,
  conflictPolicy,
  conflictSlotName,
  gameSummary,
  isUntouchedGame,
  isSlotDoc,
  mergeSettings,
  newerSide,
  planDoc,
  planImages,
  slotDoc,
  slotIdOf,
  stripLocalSettings,
  type GameSummary,
  type RemoteDoc,
} from "./sync";
import {
  downloadImage,
  listImages,
  pullDocs,
  pushDoc,
  pushTombstone,
  removeImage,
  uploadImage,
  type Account,
} from "./supabaseClient";

/** How long after the last local write a sync is attempted. */
export const SYNC_DEBOUNCE_MS = 5000;

/**
 * What the engine needs from the app. Ports rather than a store import: the
 * store already imports this module to drive it, so the arrow can only go one
 * way — and a port list is also the complete, readable answer to "what can a
 * sync change?".
 */
export interface SyncPorts {
  settings: () => Settings;
  account: () => Account | null;
  /** True while a turn streams — the active game is mid-write and off limits. */
  busy: () => boolean;
  game: () => GameState;
  /**
   * Adopt a pulled game. `legacyCast` means the document was written before the
   * cast moved into it and carries none — the store keeps the cast it already
   * has rather than adopting an empty one.
   */
  adoptGame: (game: GameState, legacyCast: boolean) => Promise<void>;
  adoptSettings: (settings: Settings) => void;
  /**
   * Both sides of the active game moved. Resolves to the copy to KEEP; the
   * other is already safe in a slot by the time this is asked.
   */
  askActiveConflict: (local: GameSummary, remote: GameSummary) => Promise<"local" | "cloud">;
  /** Named slots changed underneath the Saves screen. */
  slotsChanged: () => void;
  onStatus: (status: SyncStatus) => void;
}

export interface SyncStatus {
  state: "idle" | "syncing" | "error";
  /** Last successful pass, ms. 0 = never. */
  lastSyncedAt: number;
  error: string | null;
}

let ports: SyncPorts | null = null;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
/** A local write arrived while a pass was running — go round again. */
let again = false;
/**
 * True while pulled data is being written into the app. Every adopt goes
 * through the normal save path (so the UI updates and the disk copy is
 * authoritative), which fires the same local-write notification a player edit
 * does — and without this the engine would answer its own writes forever.
 */
let applying = false;
let failures = 0;
let lastSyncedAt = 0;

const status = (state: SyncStatus["state"], error: string | null = null) =>
  ports?.onStatus({ state, lastSyncedAt, error });

/** Human-readable reason, never an object nobody can read. */
const reason = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : "Sync failed.";

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

/**
 * Begin syncing: on local writes (debounced), and whenever the app comes back
 * to the foreground — which on a phone is the moment that matters, since the
 * other device's turns landed while this one was in a pocket.
 */
export function startSync(next: SyncPorts): void {
  stopSync();
  ports = next;
  unsubscribe = onLocalWrite(() => {
    // Mid-pass writes — the engine's own adopts, and any real edit made while
    // one is in flight — are answered by one more pass rather than immediately.
    // They cannot loop: the extra pass finds its stamps already clean.
    if (running || applying) {
      again = true;
      return;
    }
    schedule(SYNC_DEBOUNCE_MS);
  });
  document.addEventListener("visibilitychange", onVisible);
  void runSync();
}

export function stopSync(): void {
  unsubscribe?.();
  unsubscribe = null;
  document.removeEventListener("visibilitychange", onVisible);
  if (timer) clearTimeout(timer);
  timer = null;
  ports = null;
}

function onVisible() {
  if (document.visibilityState === "visible") schedule(0);
}

function schedule(delay: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runSync();
  }, delay);
}

/* ------------------------------------------------------------------ *
 * One pass
 * ------------------------------------------------------------------ */

/**
 * Run one sync. Single-flight: a second call while one is in flight sets a flag
 * and returns, so a burst of autosaves cannot open a burst of connections.
 */
export async function runSync(): Promise<void> {
  const p = ports;
  if (!p || running) {
    if (p && running) again = true;
    return;
  }
  const settings = p.settings();
  const account = p.account();
  if (!settings.syncEnabled || !account) return;

  running = true;
  status("syncing");
  try {
    await syncPass(p, settings, account);
    failures = 0;
    lastSyncedAt = Date.now();
    status("idle");
  } catch (err) {
    failures++;
    status("error", reason(err));
    // Transient failures are the common case on a phone (no signal, captive
    // wifi), so a few backed-off retries happen quietly before the player is
    // expected to care. After that it waits for the next write or foreground.
    if (failures < MAX_ATTEMPTS) schedule(backoffMs(failures));
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule(SYNC_DEBOUNCE_MS);
    }
  }
}

async function syncPass(p: SyncPorts, settings: Settings, account: Account): Promise<void> {
  const device = await deviceId();
  const now = Date.now();

  // Signed into a different account than the stamps describe — see
  // `db.ts → readSyncAccount`. Wiping them is what turns "silently adopt the
  // new account's cloud game" into "ask", which is the whole point.
  if ((await readSyncAccount()) !== account.id) {
    await clearSyncStamps();
    await writeSyncAccount(account.id);
  }

  const stamps = await readDocStamps();
  const remoteDocs = await pullDocs(settings);
  const byKey = new Map(remoteDocs.map((d) => [d.key, d]));

  const storedGame = await readActiveGame();
  const localSlots = await listSlotIds();
  const hasLocal = new Map<string, boolean>([
    // An unplayed game is not a game: a device that just installed the app has
    // a fresh scenario sitting in `active`, and treating it as a rival copy
    // would greet every new device with a conflict prompt.
    [ACTIVE_DOC, storedGame !== null && !isUntouchedGame(storedGame)],
    [SETTINGS_DOC, true], // settings always exist — defaults are settings too
    ...localSlots.map((id) => [slotDoc(id), true] as [string, boolean]),
  ]);

  const keys = new Set<string>([...hasLocal.keys(), ...byKey.keys(), ...Object.keys(stamps)]);

  for (const key of keys) {
    // Left alone entirely — see `sync.ts → LEGACY_CHARACTERS_DOC`.
    if (key === LEGACY_CHARACTERS_DOC) continue;
    // A turn is streaming: the game in hand is half-written and the message
    // list is about to change again. Skip just this key — the rest of the
    // documents have nothing to do with the turn.
    if (key === ACTIVE_DOC && p.busy()) continue;

    const present = hasLocal.get(key) ?? false;
    // An unplayed active game also has to drop its stamp, or "written locally
    // since the last sync" (hydrate autosaves on every launch) would read as a
    // change worth defending and turn a first sign-in into a conflict prompt.
    // Only the active game: a missing SLOT genuinely is a deletion to push.
    const stamp = key === ACTIVE_DOC && !present ? undefined : stamps[key];
    const remote = byKey.get(key) ?? null;
    const action = planDoc(stamp, present, remote);
    if (action === "none") continue;

    const at = stamp?.localAt ?? now;
    if (action === "push") {
      await push(p, settings, account, key, present, at, device);
      continue;
    }
    if (action === "pull") {
      await pull(p, key, remote!);
      continue;
    }
    await resolve(p, settings, account, key, remote!, at, device);
  }

  await syncImages(settings, account);
}

/* ------------------------------------------------------------------ *
 * Directions
 * ------------------------------------------------------------------ */

/** Whatever this device holds under `key`, ready to be sent. */
async function localBody(p: SyncPorts, key: string): Promise<unknown> {
  if (key === ACTIVE_DOC) return (await readActiveGame()) ?? p.game();
  // Settings live in memory, not in IndexedDB, so the store's copy IS the
  // stored copy — read fresh rather than from the pass's opening snapshot.
  if (key === SETTINGS_DOC) return stripLocalSettings(p.settings());
  return await readSlot(slotIdOf(key));
}

async function push(
  p: SyncPorts,
  settings: Settings,
  account: Account,
  key: string,
  present: boolean,
  at: number,
  device: string,
): Promise<void> {
  // Gone here but stamped as changed = a deletion this device owes the other.
  if (!present) {
    const remoteAt = await pushTombstone(settings, account.id, key, device);
    await writeDocStamp(key, { localAt: at, syncedAt: at, remoteAt });
    return;
  }
  const body = await localBody(p, key);
  if (body === null || body === undefined) return;
  const remoteAt = await pushDoc(settings, account.id, key, body, device);
  await writeDocStamp(key, { localAt: at, syncedAt: at, remoteAt });
}

async function pull(p: SyncPorts, key: string, remote: RemoteDoc): Promise<void> {
  await apply(async () => {
    if (remote.deleted) {
      if (isSlotDoc(key)) {
        await deleteSlot(slotIdOf(key));
        p.slotsChanged();
      }
      return;
    }
    if (key === ACTIVE_DOC) {
      await adoptRemoteGame(p, remote.doc as GameState);
      return;
    }
    if (key === SETTINGS_DOC) {
      p.adoptSettings(mergeSettings(p.settings(), (remote.doc ?? {}) as Partial<Settings>));
      return;
    }
    if (isSlotDoc(key)) {
      const slot = remote.doc as SaveSlot | null;
      // A row with no game behind it would render as a slot that restores
      // nothing — skip it and let the stamp move on rather than storing junk
      // the player can only discover by pressing Restore.
      if (!slot?.id || !slot.game) return;
      await saveSlot(slot);
      p.slotsChanged();
    }
  });
  const now = Date.now();
  await writeDocStamp(key, { localAt: now, syncedAt: now, remoteAt: remote.updatedAt });
}

/**
 * Both sides moved. `conflictPolicy` says how that is settled per document —
 * only the active game reaches the player.
 */
async function resolve(
  p: SyncPorts,
  settings: Settings,
  account: Account,
  key: string,
  remote: RemoteDoc,
  at: number,
  device: string,
): Promise<void> {
  switch (conflictPolicy(key)) {
    case "newest": {
      if (newerSide(at, remote.updatedAt) === "remote") await pull(p, key, remote);
      else await push(p, settings, account, key, true, at, device);
      return;
    }
    case "remote":
      // A save slot is an immutable snapshot under a unique id, so "both
      // changed" can only mean one side re-uploaded the same thing.
      await pull(p, key, remote);
      return;
    case "ask":
      await askAboutGame(p, settings, account, remote, at, device);
  }
}

/**
 * The only prompt in the whole feature: two real games under one save.
 *
 * Both copies are snapshotted to named slots BEFORE the question is asked, so
 * whichever way it is answered — and whatever happens next, including the app
 * being killed mid-prompt — neither game is gone.
 */
async function askAboutGame(
  p: SyncPorts,
  settings: Settings,
  account: Account,
  remote: RemoteDoc,
  at: number,
  device: string,
): Promise<void> {
  const localGame = (await readActiveGame()) ?? p.game();
  const remoteGame = loadGame(remote.doc as GameState)?.game;
  if (!remoteGame) {
    // Nothing readable on the server — this device's game is the only game.
    await push(p, settings, account, ACTIVE_DOC, true, at, device);
    return;
  }

  const remoteAtMs = Date.parse(remote.updatedAt) || Date.now();
  await keepSafe(localGame, "local", at);
  await keepSafe(remoteGame, "cloud", remoteAtMs);
  p.slotsChanged();

  const choice = await p.askActiveConflict(
    gameSummary(localGame, at),
    gameSummary(remoteGame, remoteAtMs),
  );

  if (choice === "cloud") {
    await pull(p, ACTIVE_DOC, remote);
    return;
  }
  // Keeping the local game means the server's copy is replaced — safe, because
  // it is sitting in a slot that just synced along with everything else.
  const now = Date.now();
  const remoteStamp = await pushDoc(settings, account.id, ACTIVE_DOC, localGame, device);
  await writeDocStamp(ACTIVE_DOC, { localAt: now, syncedAt: now, remoteAt: remoteStamp });
}

/** Snapshot one side of a conflict into a named slot. */
async function keepSafe(game: GameState, side: "local" | "cloud", when: number): Promise<void> {
  const slot: SaveSlot = {
    id: `conflict-${side}-${when}`,
    name: conflictSlotName(side, when),
    savedAt: when,
    game: structuredClone(game),
  };
  await saveSlot(slot);
}

async function adoptRemoteGame(p: SyncPorts, doc: GameState): Promise<void> {
  const loaded = loadGame(doc);
  if (!loaded) return;
  await p.adoptGame(loaded.game, loaded.legacyCast);
}

/** Run a write of PULLED data without the engine hearing its own footsteps. */
async function apply(fn: () => Promise<void> | void): Promise<void> {
  applying = true;
  try {
    await fn();
  } finally {
    applying = false;
  }
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

/**
 * Blobs move on the same three-way comparison as documents, minus the prompt:
 * two versions of a portrait are not two stories, so the newer one wins
 * silently (`sync.ts → planImages`).
 *
 * A failed blob never fails the pass. Images are a cache — a portrait that did
 * not make it across is redrawn or re-synced later, and stopping here would
 * take the game text down with it.
 */
async function syncImages(settings: Settings, account: Account): Promise<void> {
  const stamps = await readImageStamps();
  const local = await listImageKeys();
  const remote = await listImages(settings, account.id);
  const plan = planImages(local, stamps, remote);
  const remoteAt = new Map(remote.map((r) => [r.key, r.updatedAt]));

  for (const key of plan.upload) {
    try {
      const blob = await loadImage(key);
      if (!blob) continue;
      await uploadImage(settings, account.id, key, blob);
      const now = Date.now();
      // The upload API returns no timestamp, so the listing that proves it
      // landed is the next pass's — until then the stamp carries the server
      // time we knew, and a redundant re-upload is the worst case.
      await writeImageStamp(key, {
        localAt: now,
        syncedAt: now,
        remoteAt: remoteAt.get(key) ?? "",
      });
    } catch {
      // Retried next pass.
    }
  }

  for (const key of plan.download) {
    try {
      const blob = await downloadImage(settings, account.id, key);
      if (!blob) continue;
      await apply(() => saveImage(key, blob));
      const now = Date.now();
      await writeImageStamp(key, {
        localAt: now,
        syncedAt: now,
        remoteAt: remoteAt.get(key) ?? "",
      });
    } catch {
      // Retried next pass.
    }
  }

  for (const key of plan.remove) {
    try {
      await removeImage(settings, account.id, key);
      // Both sides agree it is gone, so the stamp has nothing left to say.
      await deleteImageStamp(key);
    } catch {
      // Retried next pass.
    }
  }
}

/** What one purge managed to remove from the cloud. */
export interface RemotePurge {
  removed: number;
  failed: number;
}

/**
 * Delete every cloud image whose cache key `matches`, and forget its stamp —
 * the remote half of Images → Stored Images → Purge.
 *
 * A local purge already stamps each deletion, so an ordinary pass would
 * propagate it — but only for keys this device HAD. A key that exists only in
 * the cloud (drawn on the other phone and never pulled here) has no stamp and
 * no local blob, and `planImages` would read it as an image this device is
 * missing and download it straight back. So the purge asks the server what is
 * there and removes it directly, rather than trusting the diff.
 *
 * Best-effort per key: a failure leaves both the object and its stamp alone,
 * which means a local deletion still propagates on a later pass.
 */
export async function purgeRemoteImages(
  settings: Settings,
  account: Account,
  matches: (key: string) => boolean,
): Promise<RemotePurge> {
  const remote = await listImages(settings, account.id);
  const out: RemotePurge = { removed: 0, failed: 0 };
  for (const image of remote) {
    if (!matches(image.key)) continue;
    try {
      await removeImage(settings, account.id, image.key);
      await deleteImageStamp(image.key);
      out.removed++;
    } catch {
      out.failed++;
    }
  }
  return out;
}
