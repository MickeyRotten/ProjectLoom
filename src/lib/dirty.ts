/**
 * The local-write bus.
 *
 * Every write worth announcing already funnels through a handful of functions
 * in `db.ts` and `settings.ts`, so those are where a "this changed" signal
 * belongs — not at the call sites, which would be dozens of chances to forget
 * one and lose a snapshot to the cloud.
 *
 * The bus announces EVERY local write, including the ones the cloud has no
 * interest in (the live game, the journal, generated art). Filtering is the
 * subscriber's job — `sync.ts → wakesSync` — because "what is worth a network
 * round trip" is a sync decision and the storage layer should not hold one.
 *
 * It is a bus rather than a direct call because the storage layer must not know
 * the sync engine exists: `syncEngine.ts` imports `settings.ts` for its config,
 * so the arrow can only point one way. Subscribers get the key that moved and
 * decide what to do with it; with nobody listening (every test, and the app
 * before sign-in) this costs one `Set` iteration over nothing.
 */

type Listener = (key: string) => void;

const listeners = new Set<Listener>();

/** Announce that `key` was written locally. Never throws into the writer. */
export function notifyLocalWrite(key: string): void {
  for (const listener of listeners) {
    try {
      listener(key);
    } catch {
      // A sync failure must never take an autosave down with it.
    }
  }
}

/** Subscribe to local writes; the returned function unsubscribes. */
export function onLocalWrite(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
