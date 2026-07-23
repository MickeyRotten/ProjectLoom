import { useEffect } from "react";
import { useStore } from "./store";
import { Header } from "./components/Header";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { SettingsScreen } from "./components/SettingsScreen";

/**
 * Phase 1 shell — the core loop: header (location · day), scrolling narration
 * log with AI options under the latest beat, and a composer (LOOK + freeform).
 * Party strip, inventory/quests views, and images arrive in later phases.
 */
export default function App() {
  const hydrate = useStore((s) => s.hydrate);
  const hydrated = useStore((s) => s.hydrated);
  const screen = useStore((s) => s.screen);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!hydrated) {
    return (
      <main className="flex min-h-full items-center justify-center bg-paper text-ink font-mono uppercase tracking-widest">
        Loom…
      </main>
    );
  }

  if (screen === "settings") return <SettingsScreen />;

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <Header />
      <ChatView />
      <Composer />
    </main>
  );
}
