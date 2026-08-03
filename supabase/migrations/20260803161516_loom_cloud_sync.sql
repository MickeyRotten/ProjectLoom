-- Project Loom — cloud sync (DESIGN.md → Cloud sync).
--
-- The whole server side, in one migration. It is idempotent by construction, so
-- it is safe to apply to a project where this SQL was already run by hand in the
-- dashboard — which is how the first device was set up before the repo carried
-- migrations at all.
--
-- The shape is deliberately dumb. Loom is a client-only app whose entire state
-- is a handful of JSON documents plus a pile of image blobs, so the server is
-- one key/value table and one private bucket. Every merge rule lives in
-- `src/lib/sync.ts`, where it can be unit-tested; the database's only job is to
-- hold the bytes and keep one account's bytes away from another's.
--
-- SECURITY: the app ships with the project URL and the ANON key, both public by
-- design. Row Level Security below is what actually protects the data — every
-- policy is `auth.uid() = user_id`, so a stolen anon key reads nothing without a
-- valid session. Never put the `service_role` key in the app.

-- ------------------------------------------------------------------ --
-- Documents: the active game, the cast library, settings, save slots.
-- ------------------------------------------------------------------ --

create table if not exists public.loom_docs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  -- 'active' | 'characters' | 'settings' | 'slot:<id>'
  key        text        not null,
  -- The document itself. Null only on a tombstone.
  doc        jsonb,
  -- A deleted save slot has to STAY deleted: without a tombstone the other
  -- device still holds the slot, pushes it back on its next sync, and the
  -- deletion undoes itself.
  deleted    boolean     not null default false,
  -- Which device wrote this revision. Not used for merging (the client's
  -- watermark decides that) — it is here so a confusing sync can be explained.
  device     text        not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.loom_docs enable row level security;

-- One policy for all four commands: you may touch your own rows and no others.
-- `with check` matters as much as `using` — without it a client could UPDATE a
-- row of its own into another user's id.
drop policy if exists "loom_docs are private to their owner" on public.loom_docs;
create policy "loom_docs are private to their owner"
  on public.loom_docs
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The pull is "everything of mine that changed since my watermark".
create index if not exists loom_docs_user_updated_idx
  on public.loom_docs (user_id, updated_at desc);

-- `updated_at` is the merge clock, so the client must not be able to set it: a
-- device with a wrong system time would otherwise win or lose every conflict
-- forever. Stamped server-side on every write instead.
create or replace function public.loom_docs_touch()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists loom_docs_touch on public.loom_docs;
create trigger loom_docs_touch
  before insert or update on public.loom_docs
  for each row execute function public.loom_docs_touch();

-- ------------------------------------------------------------------ --
-- Images: generated 1-bit blobs and their pre-1-bit `src:` masters.
-- Objects live at `<user_id>/<base64url(cache key)>` — cache keys are free text
-- ("banner:Boars Head Tavern"), so they are encoded rather than used as path
-- segments. The first path segment being the user id is what the policy matches.
--
-- Both statements are wrapped, because `storage.objects` and `storage.buckets`
-- are owned by `supabase_storage_admin`: on some projects the role running a
-- migration cannot touch them, and an unguarded failure here would abort a
-- migration whose table half is the important part. A skipped bucket is a
-- two-tap fix in the dashboard (Storage → New bucket, public off; then
-- Policies → New policy with the same expression); a failed migration is a red
-- check and no sync at all.
--
-- The bucket is ALSO declared in `supabase/config.toml`, which is what creates
-- it when the Supabase GitHub integration deploys. Both paths are idempotent,
-- and having both is what makes the repo work whether or not that integration
-- is switched on.
-- ------------------------------------------------------------------ --

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('loom-images', 'loom-images', false)
  on conflict (id) do nothing;
exception
  when insufficient_privilege then
    raise notice 'loom: could not create the loom-images bucket — make it in the dashboard (Storage → New bucket, public off).';
end;
$$;

do $$
begin
  execute 'drop policy if exists "loom images are private to their owner" on storage.objects';
  execute $p$
    create policy "loom images are private to their owner"
      on storage.objects
      for all
      to authenticated
      using (
        bucket_id = 'loom-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
      with check (
        bucket_id = 'loom-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      )
  $p$;
exception
  when insufficient_privilege then
    raise notice 'loom: could not create the storage policy — add it in the dashboard (Storage → loom-images → Policies).';
end;
$$;
