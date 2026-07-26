import { useEffect, useRef } from "react";
import { useStore } from "./store";
import { Header } from "./components/Header";
import { Banner } from "./components/Banner";
import { ChatView } from "./components/ChatView";
import { PartyStrip } from "./components/PartyStrip";
import { Composer } from "./components/Composer";
import { MenuScreen } from "./components/MenuScreen";
import { SetupScreen } from "./components/SetupScreen";
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
 * narration log with AI options under the latest beat, the party portrait
 * strip, and a composer (quick actions · freeform input · GO · ⋯ context menu).
 * Full-screen overlays (member sheet, party, inventory, settings) open over the
 * chat.
 */
export default function App() {
  const hydrate = useStore((s) => s.hydrate);
  const hydrated = useStore((s) => s.hydrated);
  const screen = useStore((s) => s.screen);
  const invert = useStore((s) => s.settings.invert);
  const setupDone = useStore((s) => s.settings.setupDone);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Android's back button and the browser's Back close the open overlay instead
  // of leaving the app. Nothing listened for either before, so on the APK the
  // system back button quit Loom from any screen.
  //
  // The trick is one spare history entry, kept alive for as long as ANY overlay
  // is open: a hardware back pops it, we close one level, and if another screen
  // is still open the effect pushes a fresh spare. At the play screen there is
  // no spare, so back leaves the app — which is what it should do there.
  const spare = useRef(false);
  const ignorePop = useRef(false);

  useEffect(() => {
    if (screen !== null && !spare.current) {
      spare.current = true;
      history.pushState({ loom: true }, "");
    } else if (screen === null && spare.current) {
      // Closed from the UI: drop the spare without our own handler seeing it.
      spare.current = false;
      ignorePop.current = true;
      history.back();
    }
  }, [screen]);

  useEffect(() => {
    const onPop = () => {
      if (ignorePop.current) {
        ignorePop.current = false;
        return;
      }
      const s = useStore.getState();
      if (s.screen === null) return; // at the play screen — let it leave.
      spare.current = false; // the entry we pushed is the one just popped
      s.goBack();
      // Re-arm here rather than leaving it to the effect below: `goBack` may
      // have been absorbed by a screen's own depth (an Advanced sub-menu) and
      // left `screen` untouched, so the effect — which only runs when `screen`
      // changes — would never fire and the next back would exit the app.
      if (useStore.getState().screen !== null) {
        spare.current = true;
        history.pushState({ loom: true }, "");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Invert Colors is our dark-mode toggle: `data-theme="dark"` swaps the
  // ink/paper tokens app-wide (theme.css), flipping every border, background,
  // and glyph — but NOT the generated banner/portrait bitmaps, which are real
  // pixels the token swap never touches. It is an attribute rather than a class
  // on purpose: a class named `invert` collides with Tailwind's own `.invert`
  // filter utility and inverted the whole page instead (see theme.css).
  // Pinning `color-scheme` to the active theme tells the engine we own theming,
  // so a dark-OS WebView won't apply its own force-dark pass (which would
  // invert those images). Keep the browser chrome (theme-color) matched to the
  // paper color too.
  useEffect(() => {
    document.documentElement.dataset.theme = invert ? "dark" : "light";
    document.documentElement.style.colorScheme = invert ? "dark" : "light";
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

  // First run: the game cannot take a turn without a key, so ask for one
  // instead of opening on a scenario that fails the moment it is touched.
  if (!setupDone) return <SetupScreen />;

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
