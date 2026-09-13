import { useEffect } from "react";
import { useStore } from "../store";
import { pillSolid } from "./material";

/**
 * AI-generated action buttons from the latest <<<LOOM>>> block, rendered under
 * the latest beat as unlabeled pills (Material redesign — no visible number).
 * The 1–4 number keys still submit an option as a normal turn; they're just
 * not printed on the button any more.
 */
export function Options() {
  const options = useStore((s) => s.options);
  const sendTurn = useStore((s) => s.sendTurn);
  const streaming = useStore((s) => s.streaming);
  const showActionOptions = useStore((s) => s.settings.features.options);

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
    <ul className="flex flex-wrap gap-2">
      {options.map((opt, i) => (
        <li key={`${i}-${opt}`}>
          <button
            type="button"
            onClick={() => void sendTurn(opt)}
            className={`text-left ${pillSolid}`}
          >
            {opt}
          </button>
        </li>
      ))}
    </ul>
  );
}
