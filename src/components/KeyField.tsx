import { useState } from "react";
import { fieldLabel, filledInput, pillOutline } from "./material";
import { KEY_SIGNUP_URL, verifyKey } from "../lib/openrouter";

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; note: string }
  | { state: "bad"; note: string };

/**
 * The OpenRouter key field, with a Test button. Shared by Narrator → Model and
 * the first-run Setup screen (`material.tsx` styling — every caller is now a
 * Material screen).
 *
 * Testing matters because nothing else in the app can tell a wrong key from a
 * right one until a turn fails: the model catalog is a public endpoint, so it
 * loads happily with garbage in this field. `verifyKey` hits the authenticated
 * `/key` endpoint, which is the cheapest real answer.
 */
export function KeyField({
  label,
  value,
  onChange,
  hint,
  placeholder = "sk-or-…",
  showSignupLink = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  placeholder?: string;
  showSignupLink?: boolean;
}) {
  const [check, setCheck] = useState<Check>({ state: "idle" });

  async function test() {
    setCheck({ state: "checking" });
    try {
      const status = await verifyKey(value);
      const credit =
        status.remaining === null
          ? "no spend limit"
          : `$${status.remaining.toFixed(2)} left`;
      setCheck({ state: "ok", note: [status.label, credit].filter(Boolean).join(" · ") });
    } catch (err) {
      setCheck({ state: "bad", note: err instanceof Error ? err.message : "Check failed." });
    }
  }

  return (
    <div className="space-y-1.5">
      <span className={fieldLabel}>{label}</span>
      <div className="flex items-stretch gap-2">
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            // Any edit invalidates the previous verdict.
            setCheck({ state: "idle" });
          }}
          placeholder={placeholder}
          className={`min-w-0 flex-1 ${filledInput}`}
        />
        <button
          type="button"
          disabled={!value.trim() || check.state === "checking"}
          onClick={() => void test()}
          className={`shrink-0 ${pillOutline}`}
        >
          {check.state === "checking" ? "…" : "Test"}
        </button>
      </div>

      {check.state === "ok" && (
        <p className="text-[13px]" role="status">
          ✓ Key works{check.note ? ` — ${check.note}` : ""}
        </p>
      )}
      {check.state === "bad" && (
        <p className="text-[13px] text-danger" role="alert">
          ✗ {check.note}
        </p>
      )}
      {hint && (
        <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">{hint}</p>
      )}
      {showSignupLink && (
        <p className="text-[12.5px] leading-relaxed text-[var(--m-text-55)]">
          No key yet? Make one at{" "}
          <a href={KEY_SIGNUP_URL} target="_blank" rel="noreferrer" className="underline">
            openrouter.ai/keys
          </a>
          . Loom talks to OpenRouter directly from this device — the key is stored here
          and sent nowhere else.
        </p>
      )}
    </div>
  );
}
