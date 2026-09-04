import { useStore } from "../store";
import { type FeatureKey } from "../lib/features";
import { MenuLink } from "./SubMenuScreen";

/**
 * The banner a play screen shows when the narrator feature behind it is off.
 *
 * The screen itself never goes away, because switching a feature off does not
 * take anything from the player: the quests, the pack and the places are all
 * still here and still editable by hand. What stopped is the STORY writing them,
 * and a missing screen would say the opposite.
 *
 * One component rather than the same paragraph pasted into five files, and it
 * carries the route back — the Journal's banner already proved that a sentence
 * naming a path ("Menu → Features") wants to be the button that goes there.
 */
export function FeatureOffNotice({
  feature,
  children,
}: {
  feature: FeatureKey;
  /** What being off means HERE, in this screen's own words. */
  children: React.ReactNode;
}) {
  const on = useStore((s) => s.settings.features[feature]);
  if (on) return null;
  return (
    <p className="border-2 border-ink p-3 text-xs uppercase tracking-widest opacity-70">
      {children} <MenuLink screen="features">Features</MenuLink>.
    </p>
  );
}
