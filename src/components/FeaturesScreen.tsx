import { OverlayHeader } from "./OverlayHeader";
import { FeaturesSection } from "./FeaturesSection";

/**
 * Menu → Features: one switch per subsystem the narrator drives, plus image
 * generation's master switch. Its own top-level screen rather than a Narrator
 * sub-menu — it is the map every other screen's off-note points back to
 * (`FeatureOffNotice`, and Images/RPG System's own notices), so a screen away
 * makes that pointer a straight line instead of a screen-then-sub-menu hop.
 */
export function FeaturesScreen() {
  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Features" />
      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        <FeaturesSection />
      </div>
    </main>
  );
}
