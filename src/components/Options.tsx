import { useEffect } from "react";
import { useStore } from "../store";

/**
 * AI-generated action buttons from the latest <<<LOOM>>> block, rendered under
 * the latest beat. Tap or number key (1–4) submits the option as a normal turn.
 */
export function Options() {
  const options = useStore((s) => s.options);
  const sendTurn = useStore((s) => s.sendTurn);
  const streaming = useStore((s) => s.streaming);
  const showActionOptions = useStore((s) => s.settings.showActionOptions);

  useEffect(() => {
    if (!showActionOptions || !options.length) return;
    const onKey = (e: KeyboardEvent) => {
      // Ignore while typing in the composer.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) {
        e.preventDefault();
        void sendTurn(options[n - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, sendTurn, showActionOptions]);

  if (!showActionOptions || !options.length || streaming) return null;

  return (
    <ul className="space-y-2">
      {options.map((opt, i) => (
        <li key={`${i}-${opt}`}>
          <button
            type="button"
            onClick={() => void sendTurn(opt)}
            className="flex w-full items-baseline gap-2 border-2 border-ink px-3 py-2 text-left active:bg-ink active:text-paper"
          >
            <span className="tabular-nums">{i + 1}.</span>
            <span>{opt}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
