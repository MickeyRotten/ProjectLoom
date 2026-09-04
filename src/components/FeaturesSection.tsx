import { useStore } from "../store";
import { allFeatures, FEATURE_KEYS, type FeatureKey } from "../lib/features";
import { Section, ToggleRow, btn } from "./fields";

/**
 * Narrator → Features: one switch per subsystem the narrator drives.
 *
 * The screen exists because the app had grown fourteen narrator subsystems and
 * switches for three of them, scattered across three screens. Everything else —
 * writing characters, opening quests, moving items, naming places, keeping time
 * — was simply what the narrator did, and a player who wanted a pure prose
 * sandbox had no way to say so.
 *
 * Off never deletes and never hides. A quest board with Quests off keeps every
 * quest, and the player still edits them by hand; what stops is the STORY
 * writing them. That is the sentence each note below is trying to make true.
 *
 * The three flags that used to live elsewhere (`options`, `journal`, `stakes`)
 * are still shown on their own screens beside the settings that configure them
 * — the same key, rendered twice. This list is the map; those are the rooms.
 */
interface FeatureSpec {
  key: FeatureKey;
  label: string;
  /** What switching it OFF actually does — stated from the off side. */
  note: string;
}

/** Groups, so fourteen identical rows read as four kinds of thing. */
type FeatureGroup = "world" | "cast" | "play" | "memory";

const GROUP_LABELS: Record<FeatureGroup, string> = {
  world: "The World",
  cast: "The Cast",
  play: "Play",
  memory: "Memory",
};

const FEATURES: Record<FeatureKey, FeatureSpec & { group: FeatureGroup }> = {
  location: {
    key: "location",
    group: "world",
    label: "Location",
    note: "Off: the narrator is not told where the scene is and cannot move it. The location stays wherever it was.",
  },
  places: {
    key: "places",
    group: "world",
    label: "Places",
    note: "Off: no areas are written up, none are shown to the narrator, and walking somewhere new costs no extra call.",
  },
  weather: {
    key: "weather",
    group: "world",
    label: "Weather",
    note: "Off: weather is neither shown nor tracked. The narrator can still describe rain — nothing records it.",
  },
  clock: {
    key: "clock",
    group: "world",
    label: "Time & Days",
    note: "Off: no day counter and no time of day. Time passes only in the prose. Journal entries lose their day boundary and fall back to the turn ceiling.",
  },
  characters: {
    key: "characters",
    group: "cast",
    label: "Characters & Party",
    note: "Off: the narrator cannot create, rename, seat or dismiss anyone, and is shown no party roster or NPC sheets. Your player character's sheet is always shown. Assemble the party yourself on the Characters screen.",
  },
  spotlight: {
    key: "spotlight",
    group: "cast",
    label: "Spotlight",
    note: "Off: nothing decides whose turn it is to speak. Companions talk when the narrator feels like it.",
  },
  gear: {
    key: "gear",
    group: "cast",
    label: "Relevant Gear",
    note: "Off: the narrator is no longer reminded which equipped item bears on what you just tried.",
  },
  conditions: {
    key: "conditions",
    group: "cast",
    label: "Conditions",
    note: "Off: no lasting marks — no broken arm, no bounty on your head. Marks already written stay on their sheets.",
  },
  inventory: {
    key: "inventory",
    group: "play",
    label: "Inventory",
    note: "Off: the narrator neither sees the pack nor adds to it. Gold stops moving. The Inventory screen is still yours.",
  },
  quests: {
    key: "quests",
    group: "play",
    label: "Quests",
    note: "Off: no quests are opened or closed, and the board is not shown. Existing quests stay on the screen.",
  },
  stakes: {
    key: "stakes",
    group: "play",
    label: "Outcome Rolls",
    note: "Off: nothing is rolled. The narrator decides how every attempt goes. Dice and risk words live under Menu → RPG System.",
  },
  options: {
    key: "options",
    group: "play",
    label: "Suggested Actions",
    note: "Off: no action buttons under a beat, and none are asked for. Wording lives under Voice & Actions.",
  },
  opVerification: {
    key: "opVerification",
    group: "play",
    label: "Verify New Characters & Items",
    note: "Off: a new character or a taken item the narrator writes applies as-is, with no second check. On, a cheap model call reviews it against the prose first and drops it if the prose doesn't back it up. Model lives under Model.",
  },
  trackCoords: {
    key: "trackCoords",
    group: "play",
    label: "Track World Coordinates",
    note: "Off: no position is computed for a new place, and existing ones are kept as-is. On, every place gets an (x, y, z) the moment the player arrives — a deterministic guess from the turn, refined by a cheap model call reading how far and which way the arrival prose says they went. Requires Places — with it off there is nowhere to keep a position. No map; positions show as plain numbers on the Places screen.",
  },
  notes: {
    key: "notes",
    group: "memory",
    label: "Narrator Writes Notes",
    note: "Off: the narrator stops writing its own World Notes. Your notes are still injected — they are the last thing left when everything here is off.",
  },
  journal: {
    key: "journal",
    group: "memory",
    label: "Journal",
    note: "Off: no entries are written and none are shown to the narrator. Everything already written is kept. Budgets live under Memory.",
  },
};

const GROUPS: FeatureGroup[] = ["world", "cast", "play", "memory"];

/** One switch, its consequence written underneath in the off voice. */
function FeatureToggle({ spec }: { spec: FeatureSpec }) {
  const on = useStore((s) => s.settings.features[spec.key]);
  const setFeature = useStore((s) => s.setFeature);
  return (
    <div className="space-y-1">
      <ToggleRow
        label={spec.label}
        state={on ? "ON" : "OFF"}
        onClick={() => setFeature(spec.key, !on)}
      />
      <p className="text-xs opacity-70">{spec.note}</p>
    </div>
  );
}

export function FeaturesSection() {
  const features = useStore((s) => s.settings.features);
  const update = useStore((s) => s.updateSettings);
  const allOff = FEATURE_KEYS.every((k) => !features[k]);
  const allOn = FEATURE_KEYS.every((k) => features[k]);

  const setAll = (on: boolean) => update({ features: allFeatures(on) });

  return (
    <>
      <p className="border-2 border-ink p-3 text-sm">
        Each switch is one thing the narrator does. Off means the narrator is neither
        shown that part of the game nor allowed to write it — nothing is deleted, and
        every screen stays yours to edit by hand. With all of them off the narrator has
        your Narrator Instructions, the Scenario, your World Notes and your character's
        sheet, and writes nothing but prose.
      </p>

      <div className="flex gap-2">
        <button type="button" onClick={() => setAll(true)} disabled={allOn} className={btn}>
          All On
        </button>
        <button type="button" onClick={() => setAll(false)} disabled={allOff} className={btn}>
          All Off
        </button>
      </div>

      {GROUPS.map((group) => (
        <div key={group} className="space-y-3">
          <Section label={GROUP_LABELS[group]} />
          {FEATURE_KEYS.filter((k) => FEATURES[k].group === group).map((k) => (
            <FeatureToggle key={k} spec={FEATURES[k]} />
          ))}
        </div>
      ))}
    </>
  );
}
