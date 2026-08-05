/**
 * Cloud saves — orchestration.
 *
 * One pass: read what the server has, decide each document's direction with
 * `sync.ts` (pure), move the bytes with `supabaseClient.ts` (network), and
 * stamp what landed. Nothing here decides a merge rule and nothing here holds
 * app state — the store hands in a small set of ports and gets called back.
 *
 * Three rules the whole file is built around:
 *
 * 1. **The live game never leaves the device.** What travels is what the player
 *    deliberately saved: named snapshots, and the settings that make a fresh
 *    install playable. A pass is therefore a rare, small thing rather than a
 *    per-turn upload of the whole transcript — and with no document that both
 *    sides can independently PLAY, there is no question left to ask.
 * 2. **A pass is only ever provoked by a snapshot or a settings edit**
 *    (`sync.ts → wakesSync`), by a launch, or by the player pressing Sync Now.
 *    Turns, journal writes and generated art wake nothing.
 * 3. **A stamp is written only after the bytes land.** A crash mid-pass leaves
 *    a key looking dirty, which costs one redundant transfer next time. The
 *    opposite order would mark a document synced that never left the device.
 */

import type { Settings } from "../types";
import {
  clearSyncStamps,
  deleteImageStamp,
  deleteSlot,
  deviceId,
  listImageKeys,
  listSlots,
  loadImage,
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
import { onLocalWrite } from "./dirty";
import { slotImageKeys } from "./images";
import { backoffMs, MAX_ATTEMPTS } from "./retry";
import {
  SETTINGS_DOC,
  isSkippedDoc,
  isSlotDoc,
  mergeSettings,
  newerSide,
  planDoc,
  planImages,
  slotDoc,
  slotIdOf,
  stripLocalSettings,
  wakesSync,
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

/** How long after a snapshot or a settings edit a sync is attempted. */
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
  adoptSettings: (settings: Settings) => void;
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
 * Begin syncing: one pass now, then one whenever a snapshot is taken, replaced
 * or deleted, or a setting changes (debounced).
 *
 * The pass on start is the launch/sign-in pull — once per app run, and the only
 * way a device that has never seen this account discovers the saves waiting for
 * it. There is deliberately no `visibilitychange` pass any more: foregrounding
 * was worth a round trip when the cloud held a game that could have advanced on
 * another device, and it is not worth one when the cloud holds snapshots that
 * only change when somebody presses Save.
 */
export function startSync(next: SyncPorts): void {
  stopSync();
  ports = next;
  unsubscribe = onLocalWrite((key) => {
    // The live game, the journal and every generated image announce themselves
    // here too. They are not what the cloud holds, so they wake nothing.
    if (!wakesSync(key)) return;
    // Mid-pass writes — the engine's own adopts, and any real edit made while
    // one is in flight — are answered by one more pass rather than immediately.
    // They cannot loop: the extra pass finds its stamps already clean.
    if (running || applying) {
      again = true;
      return;
    }
    schedule(SYNC_DEBOUNCE_MS);
  });
  void runSync();
}

export function stopSync(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (timer) clearTimeout(timer);
  timer = null;
  ports = null;
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
    // expected to care. After that it waits for the next snapshot, the next
    // launch, or Sync Now.
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
  // `db.ts → readSyncAccount`. Every stamp describes a document that account
  // never wrote, so none of them can be trusted to say what has already synced.
  if ((await readSyncAccount()) !== account.id) {
    await clearSyncStamps();
    await writeSyncAccount(account.id);
  }

  const stamps = await readDocStamps();
  const remoteDocs = await pullDocs(settings);
  const byKey = new Map(remoteDocs.map((d) => [d.key, d]));

  const localSlots = await listSlots();
  const hasLocal = new Map<string, boolean>([
    [SETTINGS_DOC, true], // settings always exist — defaults are settings too
    ...localSlots.map((s) => [slotDoc(s.id), true] as [string, boolean]),
  ]);

  const keys = new Set<string>([...hasLocal.keys(), ...byKey.keys(), ...Object.keys(stamps)]);

  for (const key of keys) {
    // The live game and the old global cast — left alone entirely, by both
    // sides. See `sync.ts → SKIPPED_DOCS`.
    if (isSkippedDoc(key)) continue;

    const present = hasLocal.get(key) ?? false;
    const stamp = stamps[key];
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

  await syncImages(settings, account, wantedImages(localSlots, remoteDocs));
}

/**
 * The art the saves need — every image key named by a slot on either side.
 *
 * Both sides, because the two halves answer different questions: the local
 * slots say what to UPLOAD, and the slots sitting in the cloud (whose bodies
 * this pass already has in hand from `pullDocs`, so this costs nothing) say
 * what to DOWNLOAD for a save this device has not restored yet.
 */
function wantedImages(local: SaveSlot[], remote: RemoteDoc[]): Set<string> {
  const wanted = new Set<string>();
  const add = (slot: SaveSlot | null | undefined) => {
    if (!slot?.game) return;
    for (const key of slotImageKeys(slot.game)) wanted.add(key);
  };
  for (const slot of local) add(slot);
  for (const doc of remote) {
    if (!isSlotDoc(doc.key) || doc.deleted) continue;
    add(doc.doc as SaveSlot | null);
  }
  return wanted;
}

/* ------------------------------------------------------------------ *
 * Directions
 * ------------------------------------------------------------------ */

/** Whatever this device holds under `key`, ready to be sent. */
async function localBody(p: SyncPorts, key: string): Promise<unknown> {
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
 * Both sides moved. Nothing asks — the newer write wins, in both directions
 * (`sync.ts → newerSide`). A slot is a name the player re-saved into on two
 * devices; settings are preferences whose later edit is the current one.
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
  if (newerSide(at, remote.updatedAt) === "remote") await pull(p, key, remote);
  else await push(p, settings, account, key, true, at, device);
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
 * silently — and only for the art the saves actually name (`sync.ts →
 * planImages`). Deletions still travel whether the key is wanted or not, which
 * is what keeps *Remove Image* and the purge buttons reaching the cloud.
 *
 * A failed blob never fails the pass. Images are a cache — a portrait that did
 * not make it across is redrawn or re-synced later, and stopping here would
 * take the saves down with it.
 */
async function syncImages(
  settings: Settings,
  account: Account,
  wanted: ReadonlySet<string>,
): Promise<void> {
  const stamps = await readImageStamps();
  const local = await listImageKeys();
  const remote = await listImages(settings, account.id);
  const plan = planImages(local, stamps, remote, wanted);
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
 * Delete every cloud image and forget its stamp — the remote half of
 * Images → Stored Images → Purge.
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
): Promise<RemotePurge> {
  const remote = await listImages(settings, account.id);
  const out: RemotePurge = { removed: 0, failed: 0 };
  for (const image of remote) {
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
