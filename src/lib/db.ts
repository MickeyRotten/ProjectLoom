import { openDB, type IDBPDatabase } from "idb";

/**
 * IndexedDB handle for on-device persistence (DESIGN.md → Persistence).
 * Two stores: `saves` for named GameState snapshots + the autosaved active
 * game, and `images` for generated 1-bit blobs (too big for localStorage),
 * keyed by `banner:<location>` / `portrait:<memberId>`.
 *
 * Phase 0 only opens the DB and declares the schema; the read/write helpers
 * arrive with the features that use them (Phase 1 saves, Phase 3 images).
 */
export const DB_NAME = "loom";
export const DB_VERSION = 1;

export const SAVES_STORE = "saves";
export const IMAGES_STORE = "images";

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
