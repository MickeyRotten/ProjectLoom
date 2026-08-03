import { useEffect, useRef } from "react";
import { useStore } from "./store";
import { fontTheme, isDarkPaper, scrimFrom } from "./lib/settings";
import { Header } from "./components/Header";
import { ChatView } from "./components/ChatView";
import { PartyStrip } from "./components/PartyStrip";
import { Composer } from "./components/Composer";
import { MenuScreen } from "./components/MenuScreen";
import { SetupScreen } from "./components/SetupScreen";
import { NarratorScreen } from "./components/NarratorScreen";
import { ImagesScreen } from "./components/ImagesScreen";
import { ScenarioScreen } from "./components/ScenarioScreen";
import { CharactersScreen } from "./components/CharactersScreen";
import { WorldNotesScreen } from "./components/WorldNotesScreen";
import { JournalScreen } from "./components/JournalScreen";
import { QuestsScreen } from "./components/QuestsScreen";
import { RpgSystemScreen } from "./components/RpgSystemScreen";
import { AppearanceScreen } from "./components/AppearanceScreen";
import { SavesScreen } from "./components/SavesScreen";
import { SyncScreen } from "./components/SyncScreen";
import { SyncConflictModal } from "./components/SyncConflictModal";
import { MemberSheet } from "./components/MemberSheet";
import { PartyScreen } from "./components/PartyScreen";
import { InventoryScreen } from "./components/InventoryScreen";
import { DiceOverlay } from "./components/DiceOverlay";

/**
 * Phase 2 shell — the core loop plus party: header (the location banner, with
 * location · day · menu along its bottom edge), scrolling
 * narration log with AI options under the latest beat, the party portrait
 * strip, and a composer (quick actions · freeform input · GO · ⋯ context menu).
 * Full-screen overlays (member sheet, party, inventory, settings) open over the
 * chat.
 */
export default function App() {
  const hydrate = useStore((s) => s.hydrate);
  const hydrated = useStore((s) => s.hydrated);
  const screen = useStore((s) => s.screen);
  const paper = useStore((s) => s.settings.paper);
  const ink = useStore((s) => s.settings.ink);
  const font = useStore((s) => s.settings.font);
  const webFonts = useStore((s) => s.settings.webFonts);
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
      // have been absorbed by a screen's own depth (a `SubMenuScreen`) and
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

  // The player's two colors, written straight onto <html> as the `--paper` /
  // `--ink` tokens every component reads (theme.css, and Tailwind's
  // `paper`/`ink` aliases). Setting them inline rather than swapping a
  // `data-theme` palette means there is exactly one place a color is decided,
  // and an arbitrary pair is no harder than the two we shipped.
  //
  // The rest is DERIVED here so it can never disagree with the pair: `--scrim`
  // is the ink at 60% (the dice-toss backdrop), and `color-scheme` follows the
  // paper's luminance. That last one is not cosmetic — it tells the engine we
  // own theming, so a dark-OS WebView won't run its own force-dark pass over
  // the generated banner/portrait bitmaps, which are real pixels no token
  // touches. The browser chrome (theme-color) matches the paper too.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--paper", paper);
    root.style.setProperty("--ink", ink);
    root.style.setProperty("--scrim", scrimFrom(ink));
    root.style.colorScheme = isDarkPaper(paper) ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", paper);
  }, [paper, ink]);

  // Font choice rides a one-attribute mechanism of its own: `data-font`
  // repoints `--font-mono` for the whole app — from theme.css for the bundled
  // faces, from webFonts.ts's injected stylesheet for added ones. Routed
  // through `fontTheme` so a stored value this build doesn't know about (or an
  // added font since removed) lands on the platform stack rather than an
  // undefined family.
  useEffect(() => {
    document.documentElement.dataset.font = fontTheme(font, webFonts);
  }, [font, webFonts]);

  if (!hydrated) {
    return (
      <main className="flex min-h-full items-center justify-center bg-paper text-ink font-mono uppercase tracking-widest">
        Loom…
      </main>
    );
  }

  // First run: the game cannot take a turn without a key, so ask for one
  // instead of opening on a scenario that fails the moment it is touched.
  //
  // Cloud Sync is the one screen reachable THROUGH setup: on a second device
  // the key being asked for is already in the account, so making the player
  // type it in to reach the sign-in that would have supplied it is a wall with
  // a door in it. Signing in pulls `setupDone` and dismisses this anyway.
  if (!setupDone && screen !== "sync") return <SetupScreen />;

  const current = () => {
    if (screen === "menu") return <MenuScreen />;
    if (screen === "narrator") return <NarratorScreen />;
    if (screen === "images") return <ImagesScreen />;
    if (screen === "scenario") return <ScenarioScreen />;
    if (screen === "characters") return <CharactersScreen />;
    if (screen === "worldnotes") return <WorldNotesScreen />;
    if (screen === "journal") return <JournalScreen />;
    if (screen === "quests") return <QuestsScreen />;
    if (screen === "rpg") return <RpgSystemScreen />;
    if (screen === "appearance") return <AppearanceScreen />;
    if (screen === "saves") return <SavesScreen />;
    if (screen === "sync") return <SyncScreen />;
    if (screen === "member") return <MemberSheet />;
    if (screen === "party") return <PartyScreen />;
    if (screen === "inventory") return <InventoryScreen />;

    return (
      <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
        <Header />
        <ChatView />
        <PartyStrip />
        <Composer />
      </main>
    );
  };

  // The dice toss sits OUTSIDE the screen switch: it is thrown the moment a turn
  // rolls, and lasts a couple of seconds, so hanging it off the play screen
  // would leave a cast stranded if anything changed screens underneath it. The
  // sync conflict prompt is outside for the same reason — a sync lands whenever
  // it lands, whatever the player has open.
  return (
    <>
      {current()}
      <DiceOverlay />
      <SyncConflictModal />
    </>
  );
}
