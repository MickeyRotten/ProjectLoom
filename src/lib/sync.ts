/**
 * Cloud saves — the pure half (DESIGN.md → Cloud saves).
 *
 * Loom stores everything on the device, which means an adventure is stuck on
 * the device it started on. The cloud is where the player's **named snapshots**
 * live, so a save taken on one device restores on another. This module holds
 * every DECISION — what to push, what to pull, which side of a clash wins, how
 * a cache key becomes a storage path — and touches nothing: no network, no
 * IndexedDB, no store. The network edge is `supabaseClient.ts` and the
 * orchestration is `syncEngine.ts`.
 *
 * That split is the point. A sync bug loses a save, and the logic that decides
 * whether a device's copy or the cloud's copy survives is exactly the kind of
 * thing that cannot be tested through a UI — so it lives here, pure and
 * unit-tested, like `deltas.ts` and `spotlight.ts`.
 */

import type { Settings } from "../types";

/* ------------------------------------------------------------------ *
 * Keys
 * ------------------------------------------------------------------ */

/** The whole document vocabulary. Slots are `slot:<id>`; settings is a singleton. */
export type SyncKey = "settings" | `slot:${string}`;

export const SETTINGS_DOC: SyncKey = "settings";

/**
 * Documents an older build synced that this one leaves strictly alone.
 *
 * `active` was the live game, mirrored on every turn — the whole reason this
 * feature had a conflict prompt, and the reason it cost a full document upload
 * per beat. `characters` was the cast, from when the library was global.
 * Neither is in `SyncKey` any more.
 *
 * Both names still have to be KNOWN, though: a device that synced under an
 * older build has a `doc:active` / `doc:characters` stamp sitting in `meta` and
 * a row sitting on the server. A pass that saw the stamp with nothing local
 * behind it would read the pair as a deletion and push a tombstone, wiping the
 * game — or the cast — out from under any device still running that build. So
 * they are skipped instead: left exactly as they are, by both sides, forever.
 */
export const LEGACY_ACTIVE_DOC = "active";
export const LEGACY_CHARACTERS_DOC = "characters";

export const SKIPPED_DOCS: readonly string[] = [LEGACY_ACTIVE_DOC, LEGACY_CHARACTERS_DOC];

export const isSkippedDoc = (key: string): boolean => SKIPPED_DOCS.includes(key);

const SLOT_DOC_PREFIX = "slot:";

/** Document key for one named save slot. */
export const slotDoc = (id: string): SyncKey => `${SLOT_DOC_PREFIX}${id}`;

export const isSlotDoc = (key: string): boolean => key.startsWith(SLOT_DOC_PREFIX);

/** The slot id inside a `slot:<id>` key, or "" for any other key. */
export const slotIdOf = (key: string): string =>
  isSlotDoc(key) ? key.slice(SLOT_DOC_PREFIX.length) : "";

/**
 * Whether a local write on this key should wake a sync pass — the whole of
 * "cloud saves, not a live mirror" in one predicate.
 *
 * `dirty.ts` announces every write the app makes: the active game on every
 * turn, every generated portrait and banner, the journal, settings, slots. The
 * engine used to ignore the key it was handed and schedule a pass for all of
 * them, which is what made syncing a per-turn upload of the entire transcript.
 * Only a snapshot and a settings edit are worth a network round trip now; the
 * live game and the image cache go nowhere on their own.
 *
 * Image writes still STAMP (`db.ts → touchImage`) — the stamp is what makes a
 * deleted portrait stay deleted on the other device — they just no longer
 * summon a pass of their own. Whatever a snapshot needs travels with it.
 */
export function wakesSync(key: string): boolean {
  if (isSkippedDoc(key)) return false;
  return key === SETTINGS_DOC || isSlotDoc(key);
}

/* ------------------------------------------------------------------ *
 * Stamps — what this device knows about one document
 * ------------------------------------------------------------------ */

/**
 * The three numbers a three-way merge needs, per document.
 *
 * `localAt` moves on every local write. `syncedAt` is the `localAt` captured
 * the last time this key was successfully synced, so `localAt > syncedAt` means
 * "changed here since". `remoteAt` is the server's `updated_at` at that same
 * moment, so a different one means "changed there since". Both true is the only
 * real conflict; everything else is a direction.
 *
 * Storing the watermark rather than comparing clocks is deliberate — two phones
 * disagree about what time it is, and a merge that trusts them loses games.
 */
export interface DocStamp {
  localAt: number;
  syncedAt: number;
  remoteAt: string;
}

export const newStamp = (localAt = 0): DocStamp => ({ localAt, syncedAt: 0, remoteAt: "" });

/** One document as it comes back from the server. */
export interface RemoteDoc<T = unknown> {
  key: string;
  doc: T | null;
  deleted: boolean;
  updatedAt: string;
}

/** One stored image object, as `storage.list()` describes it. */
export interface RemoteImage {
  key: string;
  updatedAt: string;
}

/**
 * What to do with one document. `conflict` is not an error — it is the honest
 * answer when both sides moved, and `conflictPolicy` decides what happens next.
 */
export type SyncAction = "push" | "pull" | "conflict" | "none";

/** Whether this device has changed the document since it last synced. */
export function localChanged(stamp: DocStamp | undefined, hasLocal: boolean): boolean {
  if (!stamp) return hasLocal; // never synced: a local copy is a change
  return stamp.localAt > stamp.syncedAt;
}

/** Whether the server's copy has moved since this device last looked. */
export function remoteChanged(
  stamp: DocStamp | undefined,
  remote: Pick<RemoteDoc, "updatedAt"> | null,
): boolean {
  if (!remote) return false;
  return remote.updatedAt !== (stamp?.remoteAt ?? "");
}

/**
 * The direction one document should move.
 *
 * `hasLocal` is separate from the stamp because "no local copy but a stamp that
 * moved" is how a deletion looks — the row is gone here and the tombstone has
 * not been pushed yet.
 */
export function planDoc(
  stamp: DocStamp | undefined,
  hasLocal: boolean,
  remote: Pick<RemoteDoc, "updatedAt" | "deleted"> | null,
): SyncAction {
  const here = localChanged(stamp, hasLocal);
  const there = remoteChanged(stamp, remote);

  if (!remote) return hasLocal ? "push" : "none";

  // A tombstone we have not applied yet wins over an unchanged local copy: the
  // player deleted this slot on the other device and meant it.
  if (remote.deleted) return there && !here ? "pull" : here ? "push" : "none";

  if (here && there) return "conflict";
  if (here) return "push";
  if (there) return "pull";
  return "none";
}

/* ------------------------------------------------------------------ *
 * Conflict resolution
 * ------------------------------------------------------------------ */

/**
 * Which side of a `conflict` wins. Nothing asks the player any more.
 *
 * The one document where both answers were real games somebody played — the
 * live game — no longer travels, and everything left has a right answer that
 * needs no interruption: settings are preferences where the newer edit is
 * simply the current one, and a slot is a named snapshot of a game that has
 * already been put somewhere safe.
 *
 * A slot used to take the server's copy on the grounds that a snapshot is
 * immutable, so the same id could not hold two different games. **Overwrite**
 * made that false: a slot is a name the player re-saves into. Newest is the
 * honest reading of "I saved over this on both devices", and it is the same
 * comparison images already settle on.
 *
 * Unparseable or missing remote time falls to the local copy — the device in
 * the player's hand is the better guess when the server's clock says nothing.
 */
export function newerSide(localAt: number, remoteUpdatedAt: string): "local" | "remote" {
  const remoteMs = Date.parse(remoteUpdatedAt);
  if (!Number.isFinite(remoteMs)) return "local";
  return remoteMs > localAt ? "remote" : "local";
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

/**
 * Storage object name for an image cache key.
 *
 * Cache keys are free text — `banner:Boars Head Tavern`, `src:portrait:<uuid>`
 * — with spaces, colons and whatever a location name contains, none of which
 * belongs in a path segment. base64url keeps the mapping reversible (so a pull
 * knows which cache key it just downloaded) without a second table.
 */
export function encodeImageName(key: string): string {
  const bytes = new TextEncoder().encode(key);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Inverse of `encodeImageName`; "" for a name that is not one of ours. */
export function decodeImageName(name: string): string {
  try {
    const padded = name.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

export interface ImagePlan {
  upload: string[];
  download: string[];
  /** Deleted here since the last sync — delete them there too. */
  remove: string[];
}

/**
 * Which image blobs move, and which way.
 *
 * Same three-way comparison as `planDoc`, minus the prompt: two versions of a
 * portrait are not two stories, so the newer one wins silently. A key with a
 * stamp, no local blob and no pending remote change is a local deletion, which
 * is the only way a removed portrait stays removed — otherwise the other
 * device's copy comes back on the next pull.
 *
 * `wanted` is the art the SNAPSHOTS need — the union of every image key named
 * by a save slot on either side (`images.ts → slotImageKeys`). Traffic is gated
 * on it, because the cache is not the point: a long game visits dozens of
 * locations and the banners of places nobody saved at are pure spend. Deletions
 * are NOT gated — a `remove` for an unwanted key still propagates, or *Remove
 * Image* and the purge buttons would stop reaching the cloud the moment the key
 * fell out of scope.
 *
 * No garbage collection here on purpose. An object in the bucket that no slot
 * names is left alone rather than deleted on the inference that nothing wants
 * it — the inference is only as good as this pass's view of the slots, and the
 * player already has *Purge Location/Character Images* for saying it out loud.
 */
export function planImages(
  localKeys: string[],
  stamps: Record<string, DocStamp>,
  remote: RemoteImage[],
  wanted: ReadonlySet<string>,
): ImagePlan {
  const local = new Set(localKeys);
  const byKey = new Map(remote.map((r) => [r.key, r]));
  const plan: ImagePlan = { upload: [], download: [], remove: [] };

  const keys = new Set<string>([...local, ...byKey.keys(), ...Object.keys(stamps)]);
  for (const key of [...keys].sort()) {
    const stamp = stamps[key];
    const rem = byKey.get(key) ?? null;
    const here = localChanged(stamp, local.has(key));
    const there = remoteChanged(stamp, rem);

    if (local.has(key)) {
      if (!wanted.has(key)) continue;
      if (!rem) plan.upload.push(key);
      else if (here && there) {
        if (newerSide(stamp?.localAt ?? 0, rem.updatedAt) === "local") plan.upload.push(key);
        else plan.download.push(key);
      } else if (here) plan.upload.push(key);
      else if (there) plan.download.push(key);
      continue;
    }

    if (rem) {
      // Gone here, still there: a deletion to propagate, unless this device
      // simply never had it.
      if (here) plan.remove.push(key);
      else if (wanted.has(key)) plan.download.push(key);
    }
  }

  return plan;
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

/**
 * Settings fields that must NOT travel. Everything else — the OpenRouter key
 * included, by the player's choice — rides along so a new device is playable
 * the moment it signs in.
 *
 * `supabaseUrl`/`supabaseAnonKey` are how this device reaches the cloud, so
 * syncing them would let one device's blank override another's working config
 * and lock it out. `comfyUrl` is a LAN address that means a different machine
 * (or nothing at all) on the other device.
 */
export const DEVICE_LOCAL_SETTINGS = [
  "supabaseUrl",
  "supabaseAnonKey",
  "syncEnabled",
  "comfyUrl",
] as const;

export type SyncedSettings = Omit<Settings, (typeof DEVICE_LOCAL_SETTINGS)[number]>;

/** The settings blob as it is pushed — minus the per-device fields. */
export function stripLocalSettings(settings: Settings): SyncedSettings {
  const out = { ...settings } as Partial<Settings>;
  for (const key of DEVICE_LOCAL_SETTINGS) delete out[key];
  return out as SyncedSettings;
}

/**
 * Apply a pulled settings blob over the ones in hand. The per-device fields
 * survive because the incoming blob does not carry them — but it is stripped
 * again here rather than trusted, since a doc written by an older build (or a
 * hand-edited row) may still hold them.
 */
export function mergeSettings(current: Settings, incoming: Partial<Settings>): Settings {
  const clean = { ...incoming } as Partial<Settings>;
  for (const key of DEVICE_LOCAL_SETTINGS) delete clean[key];
  return { ...current, ...clean };
}

