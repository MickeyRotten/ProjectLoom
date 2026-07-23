import { useEffect } from "react";
import { useStore } from "./store";
import { Header } from "./components/Header";
import { Banner } from "./components/Banner";
import { ChatView } from "./components/ChatView";
import { PartyStrip } from "./components/PartyStrip";
import { Composer } from "./components/Composer";
import { SettingsScreen } from "./components/SettingsScreen";
import { MemberSheet } from "./components/MemberSheet";
import { PartyScreen } from "./components/PartyScreen";
import { InventoryScreen } from "./components/InventoryScreen";

/**
 * Phase 2 shell — the core loop plus party: header (location · day), scrolling
 * narration log with AI options under the latest beat, the party portrait
 * strip, and a composer (LOOK · PARTY · INVENTORY + freeform). Full-screen
 * overlays (member sheet, party, inventory, settings) open over the chat.
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
  if (screen === "member") return <MemberSheet />;
  if (screen === "party") return <PartyScreen />;
  if (screen === "inventory") return <InventoryScreen />;

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <Header />
      <Banner />
      <ChatView />
      <PartyStrip />
      <Composer />
    </main>
  );
}
