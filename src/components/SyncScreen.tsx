import { useState } from "react";
import { useStore } from "../store";
import { useConfirm } from "./useConfirm";
import {
  MaterialHeader,
  Switch,
  card,
  fieldLabel,
  filledInput,
  pillOutline,
  pillSolid,
} from "./material";
import { syncConfig, syncConfigured } from "../lib/supabaseClient";

/**
 * Cloud Saves (DESIGN.md → Cloud saves) — Material redesign (`Loom Material
 * Redesign.dc.html`). Sign in and every snapshot taken from the Saves screen
 * is kept in the cloud, so a save made on one device restores on another.
 *
 * Deliberately one screen with no options beyond the account: what travels is
 * not a menu of checkboxes, because a half-synced save is worse than none. What
 * does NOT travel is the game currently being played — that is the difference
 * between this and a live mirror, and it is why nothing here can interrupt a
 * turn or ask which of two games to keep.
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
  const [projectOpen, setProjectOpen] = useState(false);
  const { ask, dialog } = useConfirm();

  const configured = syncConfigured(settings);
  const config = syncConfig(settings);
  const canSubmit = Boolean(email.trim() && password && !authPending && configured);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
      <MaterialHeader title="Cloud Saves" back />

      <div className="flex-1 space-y-3.5 overflow-y-auto px-4 pb-6">
        {!account && (
          <p className="text-[13px] leading-relaxed text-[var(--m-text-55)]">
            Sign in and every snapshot you take is kept in the cloud, so a save made on
            one device can be restored on another. The game you are playing now stays
            here until you save it. Off, Loom plays exactly as before: everything stays
            on this device and nothing is sent.
          </p>
        )}

        {account && (
          <div className={`space-y-3.5 ${card}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[15px] font-medium">Signed in</span>
              <span className="truncate text-[13px] text-[var(--m-text-55)]">
                {account.email}
              </span>
            </div>

            <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]" role="status">
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
                className={pillOutline}
              >
                Sync Now
              </button>
              <button
                type="button"
                onClick={() =>
                  ask(
                    {
                      title: "Sign out of cloud saves?",
                      body: "This device keeps everything it already has and stops syncing. Nothing in the cloud is deleted.",
                      confirmLabel: "Sign out",
                    },
                    () => void signOut(),
                  )
                }
                className={`ml-auto ${pillOutline}`}
              >
                Sign Out
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--m-surface-strong)] px-3.5 py-2.5">
              <span className="text-[14px]">Cloud Saves</span>
              <Switch
                on={settings.syncEnabled}
                ariaLabel="Cloud Saves"
                onClick={() => setSyncEnabled(!settings.syncEnabled)}
              />
            </div>
          </div>
        )}

        {!account && (
          <form
            className={`space-y-3 ${card}`}
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) void signIn(email, password);
            }}
          >
            <div className="space-y-1.5">
              <span className={fieldLabel}>Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={filledInput}
              />
            </div>
            <div className="space-y-1.5">
              <span className={fieldLabel}>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={filledInput}
              />
            </div>

            {!configured && (
              <p className="text-[13px] text-danger" role="alert">
                No Supabase project configured — fill in the URL and anon key below.
              </p>
            )}
            {authError && (
              <p className="text-[13px] text-danger" role="alert">
                ✗ {authError}
              </p>
            )}
            {authNotice && (
              <p className="text-[13px] text-[var(--m-text-55)]" role="status">
                {authNotice}
              </p>
            )}

            <div className="flex gap-2">
              <button type="submit" disabled={!canSubmit} className={pillSolid}>
                {authPending ? "…" : "Sign In"}
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void signUp(email, password)}
                className={`ml-auto ${pillOutline}`}
              >
                Create Account
              </button>
            </div>
          </form>
        )}

        {/* The project this device talks to. Closed by default: the packaged
            build already carries one, and a player who never runs their own
            Supabase should not have to look at two credential fields. */}
        <div className={card}>
          <button
            type="button"
            aria-expanded={projectOpen}
            onClick={() => setProjectOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2.5 text-left text-[15px] font-medium"
          >
            <span>Supabase Project</span>
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="var(--m-outline)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`shrink-0 transition-transform ${projectOpen ? "rotate-180" : ""}`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {projectOpen && (
            <div className="mt-3.5 space-y-3">
              <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">
                Leave blank to use the project this build ships with
                {config.url ? ` (${config.url})` : " (none configured)"}. Both values are
                public — they are what every Supabase app ships with, and the database's
                row-level security is what keeps your saves yours. Never paste a service
                role key here.
              </p>
              <div className="space-y-1.5">
                <span className={fieldLabel}>Project URL</span>
                <input
                  value={settings.supabaseUrl}
                  onChange={(e) => updateSettings({ supabaseUrl: e.target.value })}
                  placeholder="https://your-project.supabase.co"
                  className={filledInput}
                />
              </div>
              <div className="space-y-1.5">
                <span className={fieldLabel}>Anon Key</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={settings.supabaseAnonKey}
                  onChange={(e) => updateSettings({ supabaseAnonKey: e.target.value })}
                  placeholder="eyJ…"
                  className={filledInput}
                />
              </div>
              <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">
                Changing either signs this device out of the old project on the next launch.
              </p>
            </div>
          )}
        </div>

        <div className={`space-y-2.5 ${card}`}>
          <span className={fieldLabel}>What travels</span>
          <p className="text-[13px] leading-relaxed text-[var(--m-text-55)]">
            Your named snapshots — each with its cast, its portraits and the location it
            was saved at — and your settings, including the OpenRouter key, so a new
            device is playable at once. A snapshot uploads when you take it. The game in
            progress, your Supabase details and the ComfyUI address stay on this device;
            added web fonts are re-added per device.
          </p>
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={!account || status.state === "syncing"}
            className={`${pillOutline} !min-h-9 !px-3.5`}
          >
            {status.state === "syncing" ? "Syncing…" : "Sync Now"}
          </button>
        </div>
      </div>
      {dialog}
    </main>
  );
}
