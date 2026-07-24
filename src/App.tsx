import { useEffect } from "react";
import { useStore } from "./store";
import { Header } from "./components/Header";
import { Banner } from "./components/Banner";
import { ChatView } from "./components/ChatView";
import { PartyStrip } from "./components/PartyStrip";
import { Composer } from "./components/Composer";
import { MenuScreen } from "./components/MenuScreen";
import { ModelKeyScreen } from "./components/ModelKeyScreen";
import { ScenarioScreen } from "./components/ScenarioScreen";
import { CharactersScreen } from "./components/CharactersScreen";
import { WorldNotesScreen } from "./components/WorldNotesScreen";
import { QuestsScreen } from "./components/QuestsScreen";
import { AdvancedScreen } from "./components/AdvancedScreen";
import { SavesScreen } from "./components/SavesScreen";
import { MemberSheet } from "./components/MemberSheet";
import { PartyScreen } from "./components/PartyScreen";
import { InventoryScreen } from "./components/InventoryScreen";

/**
 * Phase 2 shell — the core loop plus party: header (location · day), scrolling
 * narration log with AI options + quick actions under the latest beat, the
 * party portrait strip, and a composer (freeform input · GO · ⋯ context menu).
 * Full-screen overlays (member sheet, party, inventory, settings) open over the
 * chat.
 */
export default function App() {
  const hydrate = useStore((s) => s.hydrate);
  const hydrated = useStore((s) => s.hydrated);
  const screen = useStore((s) => s.screen);
  const invert = useStore((s) => s.settings.invert);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Apply the invert theme app-wide and keep the browser chrome (theme-color)
  // matched to the paper color, so it's white-on-load and black when inverted.
  useEffect(() => {
    document.documentElement.classList.toggle("invert", invert);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", invert ? "#000000" : "#ffffff");
  }, [invert]);

  if (!hydrated) {
    return (
      <main className="flex min-h-full items-center justify-center bg-paper text-ink font-mono uppercase tracking-widest">
        Loom…
      </main>
    );
  }

  if (screen === "menu") return <MenuScreen />;
  if (screen === "modelkey") return <ModelKeyScreen />;
  if (screen === "scenario") return <ScenarioScreen />;
  if (screen === "characters") return <CharactersScreen />;
  if (screen === "worldnotes") return <WorldNotesScreen />;
  if (screen === "quests") return <QuestsScreen />;
  if (screen === "advanced") return <AdvancedScreen />;
  if (screen === "saves") return <SavesScreen />;
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
