import { openDB, type IDBPDatabase } from "idb";
import type { Character, GameState, LegacyCharacter } from "../types";
import { migrateCharacter, splitLegacyGame, type LoadedGame } from "./defaults";
import {
  ACTIVE_DOC,
  CHARACTERS_DOC,
  newStamp,
  slotDoc,
  type DocStamp,
  type SyncKey,
} from "./sync";
import { notifyLocalWrite } from "./dirty";

/**
 * IndexedDB handle for on-device persistence (DESIGN.md → Persistence).
 * Two stores: `saves` for named GameState snapshots + the autosaved active
 * game, and `images` for generated 1-bit blobs (too big for localStorage),
 * keyed by `banner:<location>` / `portrait:<memberId>`.
 *
 * Phase 1 adds the active-game autosave helpers; named slots (Phase 4) and
 * image blobs (Phase 3) reuse the same stores.
 */
export const DB_NAME = "loom";
/**
 * v2 adds `fonts` — the woff2 files behind player-added Google Web Fonts. They
 * get a store of their own rather than a key prefix inside `images`, because
 * `images.ts` enumerates that keyspace and a font file is not an image.
 *
 * v3 adds `meta` — the sync bookkeeping (`sync.ts → DocStamp` per document and
 * per image, plus this device's id). It is not game state and must survive a
 * restore, so it sits outside `saves` entirely.
 */
export const DB_VERSION = 3;

export const SAVES_STORE = "saves";
export const IMAGES_STORE = "images";
export const FONTS_STORE = "fonts";
export const META_STORE = "meta";

/** Reserved key for the continuously-autosaved active game. */
export const ACTIVE_KEY = "__active__";

/**
 * Reserved key for the GLOBAL character library. It sits outside every game
 * snapshot on purpose: the cast survives New Adventure, and restoring an old
 * save slot must never delete a character authored since that save.
 */
export const CHARACTERS_KEY = "__characters__";

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(SAVES_STORE)) {
          db.createObjectStore(SAVES_STORE);
        }
        if (!db.objectStoreNames.contains(IMAGES_STORE)) {
          db.createObjectStore(IMAGES_STORE);
        }
        if (!db.objectStoreNames.contains(FONTS_STORE)) {
          db.createObjectStore(FONTS_STORE);
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE);
        }
      },
    });
  }
  return dbPromise;
}

/** Persist the active game (autosave). */
export async function saveActiveGame(game: GameState): Promise<void> {
  const db = await getDB();
  await db.put(SAVES_STORE, game, ACTIVE_KEY);
  await touchDoc(ACTIVE_DOC);
}

/**
 * Load the autosaved active game, or null on a fresh install. Merges over a
 * fresh skeleton so older-shape saves gain later-phase slices, and returns any
 * characters recovered from a pre-split save alongside the game.
 */
export async function loadActiveGame(): Promise<LoadedGame | null> {
  const db = await getDB();
  const game = (await db.get(SAVES_STORE, ACTIVE_KEY)) as GameState | undefined;
  return splitLegacyGame(game);
}

/** Persist the global character library. */
export async function saveCharacters(characters: Character[]): Promise<void> {
  const db = await getDB();
  await db.put(SAVES_STORE, characters, CHARACTERS_KEY);
  await touchDoc(CHARACTERS_DOC);
}

/**
 * Load the global character library, or null before it has ever been written.
 * Every record goes through `migrateCharacter` — this store outlives every
 * field rename (Strengths losing its label, `flaws` arriving), and it is the
 * authoritative copy of the cast, so a stale shape here reaches every screen.
 */
export async function loadCharacters(): Promise<Character[] | null> {
  const db = await getDB();
  const stored = (await db.get(SAVES_STORE, CHARACTERS_KEY)) as LegacyCharacter[] | undefined;
  return Array.isArray(stored) ? stored.map(migrateCharacter) : null;
}

/* ------------------------------------------------------------------ *
 * Named save slots (Phase 4). Full GameState snapshots, each stored under
 * `slot:<id>` in the same SAVES_STORE alongside a little metadata wrapper.
 * "New Adventure" is separate (it reseeds the active game); slots are manual
 * snapshot/restore points.
 * ------------------------------------------------------------------ */

const SLOT_PREFIX = "slot:";

/** A stored snapshot: metadata for the Saves list plus the full game. */
export interface SaveSlot {
  id: string;
  name: string;
  savedAt: number;
  game: GameState;
}

const slotKey = (id: string) => `${SLOT_PREFIX}${id}`;

/** Snapshot a game into a named slot (creates or overwrites by id). */
export async function saveSlot(slot: SaveSlot): Promise<void> {
  const db = await getDB();
  await db.put(SAVES_STORE, slot, slotKey(slot.id));
  await touchDoc(slotDoc(slot.id));
}

/** Restore a slot's game snapshot, or null if the slot is gone. */
export async function loadSlot(id: string): Promise<LoadedGame | null> {
  const db = await getDB();
  const slot = (await db.get(SAVES_STORE, slotKey(id))) as SaveSlot | undefined;
  return splitLegacyGame(slot?.game);
}

/** Delete a named slot. */
export async function deleteSlot(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(SAVES_STORE, slotKey(id));
  // Marked, not forgotten: the stamp is what turns the missing row into a
  // tombstone the other device can be told about. Dropping it here instead
  // would let the slot come back on the next pull.
  await touchDoc(slotDoc(id));
}

/** Ids of every slot stored on this device — the local side of a sync diff. */
export async function listSlotIds(): Promise<string[]> {
  const db = await getDB();
  const keys = (await db.getAllKeys(SAVES_STORE)) as IDBValidKey[];
  return keys
    .filter((k): k is string => typeof k === "string" && k.startsWith(SLOT_PREFIX))
    .map((k) => k.slice(SLOT_PREFIX.length));
}

/** One slot exactly as stored — what a push sends. */
export async function readSlot(id: string): Promise<SaveSlot | null> {
  const db = await getDB();
  return ((await db.get(SAVES_STORE, slotKey(id))) as SaveSlot | undefined) ?? null;
}

/** The stored active game, unmigrated — what a push sends. */
export async function readActiveGame(): Promise<GameState | null> {
  const db = await getDB();
  return ((await db.get(SAVES_STORE, ACTIVE_KEY)) as GameState | undefined) ?? null;
}

/** All slots, newest first — metadata only is needed, but we hold the game too. */
export async function listSlots(): Promise<SaveSlot[]> {
  const db = await getDB();
  const keys = (await db.getAllKeys(SAVES_STORE)) as IDBValidKey[];
  const slotKeys = keys.filter((k) => typeof k === "string" && k.startsWith(SLOT_PREFIX));
  const slots = (await Promise.all(slotKeys.map((k) => db.get(SAVES_STORE, k)))) as SaveSlot[];
  return slots.filter(Boolean).sort((a, b) => b.savedAt - a.savedAt);
}

/* ------------------------------------------------------------------ *
 * Generated image blobs (Phase 3). Keyed by `banner:<location>` /
 * `portrait:<memberId>`; the UI reads them back as object URLs.
 * ------------------------------------------------------------------ */

/** Store (or replace) a generated image blob under its cache key. */
export async function saveImage(key: string, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put(IMAGES_STORE, blob, key);
  await touchImage(key);
}

/** Load a cached image blob, or null if none exists for the key. */
export async function loadImage(key: string): Promise<Blob | null> {
  const db = await getDB();
  const blob = (await db.get(IMAGES_STORE, key)) as Blob | undefined;
  return blob ?? null;
}

/** Remove a cached image blob. */
export async function deleteImage(key: string): Promise<void> {
  const db = await getDB();
  await db.delete(IMAGES_STORE, key);
  await touchImage(key);
}

/** Every cache key with a blob behind it — the local side of an image diff. */
export async function listImageKeys(): Promise<string[]> {
  const db = await getDB();
  const keys = (await db.getAllKeys(IMAGES_STORE)) as IDBValidKey[];
  return keys.filter((k): k is string => typeof k === "string");
}

/* ------------------------------------------------------------------ *
 * Downloaded web-font files. One added font is several woff2 subsets, stored
 * under `font:<id>:<i>` and read back as object URLs by `webFonts.ts`. This is
 * what makes an added font behave like a bundled one: downloaded once, then
 * never a network request again, on a device that plays offline.
 * ------------------------------------------------------------------ */

const FONT_PREFIX = "font:";

const fontKey = (id: string, index: number) => `${FONT_PREFIX}${id}:${index}`;

/** Store one subset file of an added font. */
export async function saveFontFile(id: string, index: number, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put(FONTS_STORE, blob, fontKey(id, index));
}

/**
 * Every stored subset file for one added font, in the order they were written.
 * An empty array means the font's files are gone — `webFonts.ts` skips such a
 * font rather than injecting a rule with nothing behind it.
 */
export async function loadFontFiles(id: string): Promise<Blob[]> {
  const db = await getDB();
  const out: Blob[] = [];
  for (let i = 0; ; i++) {
    const blob = (await db.get(FONTS_STORE, fontKey(id, i))) as Blob | undefined;
    if (!blob) return out;
    out.push(blob);
  }
}

/* ------------------------------------------------------------------ *
 * Sync bookkeeping (`meta`). One `DocStamp` per document and per image,
 * plus this device's id. See `sync.ts` for what the three numbers mean.
 *
 * It is written on EVERY local save — which is why it is a per-key record
 * rather than one blob: a turn autosaving while a sync is mid-flight would
 * otherwise read-modify-write over the stamp the sync just wrote.
 *
 * The `localAt` write is what makes an offline change survive a restart. If it
 * only lived in memory, a game played on a plane would look unchanged to the
 * next sync and be quietly overwritten by the cloud copy.
 * ------------------------------------------------------------------ */

const DOC_STAMP_PREFIX = "doc:";
const IMAGE_STAMP_PREFIX = "img:";
const DEVICE_KEY = "device";

async function readStamps(prefix: string): Promise<Record<string, DocStamp>> {
  const db = await getDB();
  const keys = (await db.getAllKeys(META_STORE)) as IDBValidKey[];
  const out: Record<string, DocStamp> = {};
  for (const k of keys) {
    if (typeof k !== "string" || !k.startsWith(prefix)) continue;
    const stamp = (await db.get(META_STORE, k)) as DocStamp | undefined;
    if (stamp) out[k.slice(prefix.length)] = stamp;
  }
  return out;
}

/**
 * Stamp a local write. Deliberately swallowing: a save must not fail because
 * its sync bookkeeping did (no IndexedDB at all in a test environment, a
 * private-mode browser, a full disk). The cost of a lost stamp is one redundant
 * transfer on the next pass.
 */
async function touch(prefix: string, key: string, at: number): Promise<void> {
  try {
    const db = await getDB();
    const metaKey = `${prefix}${key}`;
    const prev = (await db.get(META_STORE, metaKey)) as DocStamp | undefined;
    await db.put(META_STORE, { ...(prev ?? newStamp()), localAt: at }, metaKey);
  } catch {
    // Non-fatal — see above.
  }
}

/** Record that a document changed on this device, and wake the sync engine. */
export async function touchDoc(key: SyncKey, at = Date.now()): Promise<void> {
  await touch(DOC_STAMP_PREFIX, key, at);
  notifyLocalWrite(key);
}

/** Same, for one image blob. */
export async function touchImage(key: string, at = Date.now()): Promise<void> {
  await touch(IMAGE_STAMP_PREFIX, key, at);
  notifyLocalWrite(`image:${key}`);
}

export const readDocStamps = (): Promise<Record<string, DocStamp>> =>
  readStamps(DOC_STAMP_PREFIX);

export const readImageStamps = (): Promise<Record<string, DocStamp>> =>
  readStamps(IMAGE_STAMP_PREFIX);

/**
 * Record a document as synced. Written AFTER the push or pull lands, so a
 * failure anywhere in between leaves the key looking dirty and it is simply
 * retried — the one direction this can be wrong in that costs nothing.
 */
export async function writeDocStamp(key: string, stamp: DocStamp): Promise<void> {
  const db = await getDB();
  await db.put(META_STORE, stamp, `${DOC_STAMP_PREFIX}${key}`);
}

export async function writeImageStamp(key: string, stamp: DocStamp): Promise<void> {
  const db = await getDB();
  await db.put(META_STORE, stamp, `${IMAGE_STAMP_PREFIX}${key}`);
}

/** Forget a stamp entirely — for a tombstone both sides have now applied. */
export async function deleteImageStamp(key: string): Promise<void> {
  const db = await getDB();
  await db.delete(META_STORE, `${IMAGE_STAMP_PREFIX}${key}`);
}

const ACCOUNT_KEY = "account";

/**
 * The account these stamps describe. A stamp says "the server's copy was X when
 * I last looked" — a statement about ONE account's data — so signing into a
 * different one makes every stamp a lie, and acting on it would let the new
 * account's cloud copy silently replace the previous account's local game.
 * Compared at the start of every pass; a mismatch wipes the stamps and the two
 * copies meet as strangers (which, for the active game, means the player is
 * asked).
 */
export async function readSyncAccount(): Promise<string> {
  const db = await getDB();
  return ((await db.get(META_STORE, ACCOUNT_KEY)) as string | undefined) ?? "";
}

export async function writeSyncAccount(id: string): Promise<void> {
  const db = await getDB();
  await db.put(META_STORE, id, ACCOUNT_KEY);
}

/** Forget every watermark — see `readSyncAccount`. Device id survives. */
export async function clearSyncStamps(): Promise<void> {
  const db = await getDB();
  const keys = (await db.getAllKeys(META_STORE)) as IDBValidKey[];
  await Promise.all(
    keys
      .filter(
        (k): k is string =>
          typeof k === "string" &&
          (k.startsWith(DOC_STAMP_PREFIX) || k.startsWith(IMAGE_STAMP_PREFIX)),
      )
      .map((k) => db.delete(META_STORE, k)),
  );
}

/**
 * This device's stable id, minted on first use. It rides along on every push so
 * a confusing sync can be traced to the device that wrote it — never used for
 * merging, which is what the stamps are for.
 */
export async function deviceId(): Promise<string> {
  const db = await getDB();
  const stored = (await db.get(META_STORE, DEVICE_KEY)) as string | undefined;
  if (stored) return stored;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await db.put(META_STORE, id, DEVICE_KEY);
  return id;
}

/** Delete every stored subset file for one added font. */
export async function deleteFontFiles(id: string): Promise<void> {
  const db = await getDB();
  const keys = (await db.getAllKeys(FONTS_STORE)) as IDBValidKey[];
  const prefix = `${FONT_PREFIX}${id}:`;
  await Promise.all(
    keys
      .filter((k) => typeof k === "string" && k.startsWith(prefix))
      .map((k) => db.delete(FONTS_STORE, k)),
  );
}
