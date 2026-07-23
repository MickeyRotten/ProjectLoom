import { openDB, type IDBPDatabase } from "idb";
import type { GameState } from "../types";

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
export const DB_VERSION = 1;

export const SAVES_STORE = "saves";
export const IMAGES_STORE = "images";

/** Reserved key for the continuously-autosaved active game. */
export const ACTIVE_KEY = "__active__";

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
      },
    });
  }
  return dbPromise;
}

/** Persist the active game (autosave). */
export async function saveActiveGame(game: GameState): Promise<void> {
  const db = await getDB();
  await db.put(SAVES_STORE, game, ACTIVE_KEY);
}

/** Load the autosaved active game, or null on a fresh install. */
export async function loadActiveGame(): Promise<GameState | null> {
  const db = await getDB();
  const game = (await db.get(SAVES_STORE, ACTIVE_KEY)) as GameState | undefined;
  return game ?? null;
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
}

/** Restore a slot's game snapshot, or null if the slot is gone. */
export async function loadSlot(id: string): Promise<GameState | null> {
  const db = await getDB();
  const slot = (await db.get(SAVES_STORE, slotKey(id))) as SaveSlot | undefined;
  return slot?.game ?? null;
}

/** Delete a named slot. */
export async function deleteSlot(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(SAVES_STORE, slotKey(id));
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
}
