/// <reference types="vite/client" />

/**
 * Build-time cloud-sync config. Both values are public by design — they are the
 * project URL and the ANON key every Supabase client app ships with, and Row
 * Level Security is what protects the data (see `supabase/schema.sql`). They
 * are baked in so the packaged APK syncs out of the box; a player running their
 * own project overrides them on the Cloud Sync screen.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
