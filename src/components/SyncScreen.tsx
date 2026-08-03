import { useState } from "react";
import { useStore } from "../store";
import { OverlayHeader } from "./OverlayHeader";
import { Collapsible, Field, TextField, ToggleRow, btn, btnSmall } from "./fields";
import { syncConfig, syncConfigured } from "../lib/supabaseClient";
import { useConfirm } from "./useConfirm";

/**
 * Cloud Sync (DESIGN.md → Persistence). Sign in and the same adventure — the
 * game, the cast, the save slots, the settings and the generated art — resumes
 * on any other device signed into the same account.
 *
 * Deliberately one screen with no options beyond the account: what syncs is not
 * a menu of checkboxes, because a half-synced save is worse than none. The only
 * choice offered is the one nobody else can make — which copy of a diverged
 * game to keep — and that is a prompt, not a setting.
 */
export function SyncScreen() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const account = useStore((s) => s.account);
  const status = useStore((s) => s.syncStatus);
  const authPending = useStore((s) => s.authPending);
  const authError = useStore((s) => s.authError);
  const authNotice = useStore((s) => s.authNotice);
  const signIn = useStore((s) => s.signIn);
  const signUp = useStore((s) => s.signUp);
  const signOut = useStore((s) => s.signOut);
  const syncNow = useStore((s) => s.syncNow);
  const setSyncEnabled = useStore((s) => s.setSyncEnabled);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { ask, dialog } = useConfirm();

  const configured = syncConfigured(settings);
  const config = syncConfig(settings);
  const canSubmit = Boolean(email.trim() && password && !authPending && configured);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Cloud Sync" />

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {!account && (
          <p className="text-sm opacity-70">
            Sign in and this device keeps the same adventure as every other one you sign
            into — the game, the cast, saved slots, settings and generated art. Off, Loom
            plays exactly as before: everything stays on this device and nothing is sent.
          </p>
        )}

        {account && (
          <div className="space-y-3 border-2 border-ink p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="uppercase tracking-widest">Signed in</span>
              <span className="truncate text-sm opacity-70">{account.email}</span>
            </div>

            <p className="text-sm opacity-70" role="status">
              {status.state === "syncing"
                ? "Syncing…"
                : status.state === "error"
                  ? `Last sync failed — ${status.error ?? "unknown error"}`
                  : status.lastSyncedAt
                    ? `Synced ${new Date(status.lastSyncedAt).toLocaleTimeString()}`
                    : "Not synced yet."}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void syncNow()}
                disabled={status.state === "syncing"}
                className={btn}
              >
                Sync Now
              </button>
              <button
                type="button"
                onClick={() =>
                  ask(
                    {
                      title: "Sign out of cloud sync?",
                      body: "This device keeps everything it already has and stops syncing. Nothing in the cloud is deleted.",
                      confirmLabel: "Sign out",
                    },
                    () => void signOut(),
                  )
                }
                className={`ml-auto ${btn}`}
              >
                Sign Out
              </button>
            </div>

            <ToggleRow
              label="Sync"
              state={settings.syncEnabled ? "On" : "Off"}
              onClick={() => setSyncEnabled(!settings.syncEnabled)}
            />
          </div>
        )}

        {!account && (
          <form
            className="space-y-3 border-2 border-ink p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) void signIn(email, password);
            }}
          >
            <TextField label="Email" value={email} onChange={setEmail} placeholder="you@example.com" />
            <Field label="Password">
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
              />
            </Field>

            {!configured && (
              <p className="text-sm" role="alert">
                No Supabase project configured — fill in the URL and anon key below.
              </p>
            )}
            {authError && (
              <p className="text-sm" role="alert">
                ✗ {authError}
              </p>
            )}
            {authNotice && (
              <p className="text-sm" role="status">
                {authNotice}
              </p>
            )}

            <div className="flex gap-2">
              <button type="submit" disabled={!canSubmit} className={btn}>
                {authPending ? "…" : "Sign In"}
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void signUp(email, password)}
                className={`ml-auto ${btn}`}
              >
                Create Account
              </button>
            </div>
          </form>
        )}

        {/* The project this device talks to. Closed by default: the packaged
            build already carries one, and a player who never runs their own
            Supabase should not have to look at two credential fields. */}
        <Collapsible label="Supabase Project">
          <p className="text-xs opacity-60">
            Leave blank to use the project this build ships with
            {config.url ? ` (${config.url})` : " (none configured)"}. Both values are
            public — they are what every Supabase app ships with, and the database's
            row-level security is what keeps your saves yours. Never paste a service
            role key here.
          </p>
          <TextField
            label="Project URL"
            value={settings.supabaseUrl}
            onChange={(v) => updateSettings({ supabaseUrl: v })}
            placeholder="https://your-project.supabase.co"
          />
          <Field label="Anon Key">
            <input
              type="password"
              autoComplete="off"
              value={settings.supabaseAnonKey}
              onChange={(e) => updateSettings({ supabaseAnonKey: e.target.value })}
              placeholder="eyJ…"
              className="w-full border-2 border-ink bg-paper p-2 focus:outline-none"
            />
          </Field>
          <p className="text-xs opacity-60">
            Changing either signs this device out of the old project on the next launch.
          </p>
        </Collapsible>

        <div className="space-y-2 border-2 border-ink p-3">
          <span className="block uppercase tracking-widest text-sm">What travels</span>
          <p className="text-sm opacity-70">
            The active game, the character library, save slots, generated portraits and
            location images, and your settings — including the OpenRouter key, so a new
            device is playable at once. Your Supabase details and the ComfyUI address
            stay on this device. Added web fonts are re-added per device.
          </p>
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={!account || status.state === "syncing"}
            className={btnSmall}
          >
            {status.state === "syncing" ? "Syncing…" : "Sync Now"}
          </button>
        </div>
      </div>
      {dialog}
    </main>
  );
}
