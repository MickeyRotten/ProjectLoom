/**
 * Cloud sync — the network edge.
 *
 * Everything that talks to Supabase is here: config resolution, the auth calls
 * behind the Cloud Sync screen, and thin document/blob wrappers over PostgREST
 * and Storage. No merge decision is taken in this file — that is `sync.ts`,
 * which is pure and tested — and no state is touched, which is `syncEngine.ts`.
 *
 * This is the one place in Loom that uses an SDK. Every other request in the app
 * is a hand-written `fetch` (OpenRouter, ComfyUI, Google Fonts) because they are
 * one-shot calls with a bearer token; a synced session is not — it refreshes an
 * access token on a timer, persists across launches, and signs Storage requests
 * — and re-implementing that correctly is how accounts get locked out.
 */

import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { Settings } from "../types";
import { encodeImageName, decodeImageName, type RemoteDoc, type RemoteImage } from "./sync";

/** Storage bucket created by `supabase/schema.sql`. */
export const IMAGE_BUCKET = "loom-images";

const DOCS_TABLE = "loom_docs";

/** Where the session is persisted. Namespaced so it reads as ours in devtools. */
const AUTH_STORAGE_KEY = "loom.supabase.auth";

export interface SyncConfig {
  url: string;
  anonKey: string;
}

/**
 * The project this device syncs with: the player's override if they typed one,
 * otherwise whatever the build was given. Blank in both means sync is
 * unconfigured — not broken — and the screen says so.
 */
export function syncConfig(settings: Settings): SyncConfig {
  return {
    url: settings.supabaseUrl.trim() || (import.meta.env.VITE_SUPABASE_URL ?? "").trim(),
    anonKey:
      settings.supabaseAnonKey.trim() || (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim(),
  };
}

export function syncConfigured(settings: Settings): boolean {
  const { url, anonKey } = syncConfig(settings);
  return Boolean(url && anonKey);
}

/**
 * Lazily-built client, rebuilt when the config changes.
 *
 * Keyed on url+key rather than rebuilt per call because the client owns the
 * session refresh timer — a fresh one per request would re-read the session
 * from storage every time and could refresh the same token twice.
 */
let client: SupabaseClient | null = null;
let clientKey = "";

/**
 * The SDK itself, fetched on first use.
 *
 * Loom is an offline-first APK whose point is a small, self-contained app, and
 * this is the largest dependency in it. Sync is opt-in, so a player who never
 * signs in never pays for it: the chunk is requested only when something needs
 * a client, and the packaged build ships it on device — "on demand" never means
 * "needs the network to load the code".
 */
let sdk: Promise<typeof import("@supabase/supabase-js")> | null = null;

export async function getClient(settings: Settings): Promise<SupabaseClient | null> {
  const { url, anonKey } = syncConfig(settings);
  if (!url || !anonKey) return null;
  const key = `${url} ${anonKey}`;
  if (client && clientKey === key) return client;
  sdk ??= import("@supabase/supabase-js");
  const { createClient } = await sdk;
  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The app is not a website and never receives an OAuth redirect; leaving
      // this on makes the client parse every launch URL looking for one.
      detectSessionInUrl: false,
      storageKey: AUTH_STORAGE_KEY,
    },
  });
  clientKey = key;
  return client;
}

/** Every call below needs a configured client — one place to say so. */
async function need(settings: Settings): Promise<SupabaseClient> {
  const c = await getClient(settings);
  if (!c) throw new Error("Cloud sync is not configured — add a Supabase URL and anon key.");
  return c;
}

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

export interface Account {
  id: string;
  email: string;
}

const accountOf = (session: Session | null): Account | null =>
  session?.user ? { id: session.user.id, email: session.user.email ?? "" } : null;

export async function currentAccount(settings: Settings): Promise<Account | null> {
  const c = await getClient(settings);
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return accountOf(data.session);
}

export async function signIn(
  settings: Settings,
  email: string,
  password: string,
): Promise<Account> {
  const c = await need(settings);
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  const account = accountOf(data.session);
  if (!account) throw new Error("Signed in, but no session came back.");
  return account;
}

/**
 * Create the account. With email confirmation ON (the Supabase default) this
 * returns no session — the player has a link to click first — so the caller is
 * told rather than left staring at a screen that looks signed out for no
 * reason.
 */
export async function signUp(
  settings: Settings,
  email: string,
  password: string,
): Promise<{ account: Account | null; needsConfirmation: boolean }> {
  const c = await need(settings);
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  const account = accountOf(data.session);
  return { account, needsConfirmation: !account };
}

export async function signOut(settings: Settings): Promise<void> {
  const c = await getClient(settings);
  if (!c) return;
  await c.auth.signOut();
}

/* ------------------------------------------------------------------ *
 * Documents
 * ------------------------------------------------------------------ */

interface DocRow {
  key: string;
  doc: unknown;
  deleted: boolean;
  updated_at: string;
}

/**
 * Every document the account holds, metadata included.
 *
 * `doc` bodies come back with it — the active game is the only large one, and a
 * second round-trip per key to fetch bodies separately would cost more than the
 * bytes do. If that ever inverts, the fix is a `select` without `doc` here plus
 * a per-key fetch in the engine; the plan it feeds does not change.
 */
export async function pullDocs(settings: Settings): Promise<RemoteDoc[]> {
  const c = await need(settings);
  const { data, error } = await c.from(DOCS_TABLE).select("key, doc, deleted, updated_at");
  if (error) throw new Error(error.message);
  return ((data ?? []) as DocRow[]).map((row) => ({
    key: row.key,
    doc: row.doc ?? null,
    deleted: row.deleted,
    updatedAt: row.updated_at,
  }));
}

/**
 * Write one document and report back the `updated_at` the SERVER stamped on it
 * — which is the value the local watermark has to record. Reading our own clock
 * here is what would make two devices with different times fight forever.
 */
export async function pushDoc(
  settings: Settings,
  userId: string,
  key: string,
  doc: unknown,
  device: string,
): Promise<string> {
  const c = await need(settings);
  const { data, error } = await c
    .from(DOCS_TABLE)
    .upsert({ user_id: userId, key, doc, deleted: false, device }, { onConflict: "user_id,key" })
    .select("updated_at")
    .single();
  if (error) throw new Error(error.message);
  return (data as { updated_at: string }).updated_at;
}

/** Same, for a deletion: the row stays as a tombstone, the body goes. */
export async function pushTombstone(
  settings: Settings,
  userId: string,
  key: string,
  device: string,
): Promise<string> {
  const c = await need(settings);
  const { data, error } = await c
    .from(DOCS_TABLE)
    .upsert(
      { user_id: userId, key, doc: null, deleted: true, device },
      { onConflict: "user_id,key" },
    )
    .select("updated_at")
    .single();
  if (error) throw new Error(error.message);
  return (data as { updated_at: string }).updated_at;
}

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

const imagePath = (userId: string, key: string) => `${userId}/${encodeImageName(key)}`;

/** Page size for a storage listing — the API's own maximum per call. */
const LIST_PAGE = 1000;

/**
 * Every stored image, as cache keys. Paged, because a long-played account holds
 * a portrait and a master per character plus a banner per location, and a single
 * page would silently truncate the diff into "delete everything past the first
 * thousand".
 */
export async function listImages(settings: Settings, userId: string): Promise<RemoteImage[]> {
  const storage = (await need(settings)).storage.from(IMAGE_BUCKET);
  const out: RemoteImage[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await storage.list(userId, { limit: LIST_PAGE, offset });
    if (error) throw new Error(error.message);
    const page = data ?? [];
    for (const file of page) {
      const key = decodeImageName(file.name);
      // A name we cannot decode was not written by this app — leave it be
      // rather than treat it as an image the device is missing.
      if (!key) continue;
      out.push({ key, updatedAt: file.updated_at ?? file.created_at ?? "" });
    }
    if (page.length < LIST_PAGE) return out;
  }
}

export async function uploadImage(
  settings: Settings,
  userId: string,
  key: string,
  blob: Blob,
): Promise<void> {
  const c = await need(settings);
  const { error } = await c.storage
    .from(IMAGE_BUCKET)
    .upload(imagePath(userId, key), blob, {
      upsert: true,
      contentType: blob.type || "image/png",
    });
  if (error) throw new Error(error.message);
}

export async function downloadImage(
  settings: Settings,
  userId: string,
  key: string,
): Promise<Blob | null> {
  const c = await need(settings);
  const { data, error } = await c.storage
    .from(IMAGE_BUCKET)
    .download(imagePath(userId, key));
  // A missing object is not a failure worth stopping a sync for: the other
  // device may have deleted it between the listing and this call.
  if (error) return null;
  return data ?? null;
}

export async function removeImage(
  settings: Settings,
  userId: string,
  key: string,
): Promise<void> {
  const c = await need(settings);
  const { error } = await c.storage.from(IMAGE_BUCKET).remove([imagePath(userId, key)]);
  if (error) throw new Error(error.message);
}
