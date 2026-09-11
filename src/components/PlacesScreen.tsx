import type { Place } from "../types";
import { useStore } from "../store";
import { findPlace } from "../lib/places";
import { OverlayHeader } from "./OverlayHeader";
import { FeatureOffNotice } from "./FeatureOffNotice";
import { AreaField, Collapsible, TextField, btn, btnSmall } from "./fields";
import { useConfirm } from "./useConfirm";

/**
 * Places — the areas this adventure knows (DESIGN.md → Places).
 *
 * Written by the arrival call and then owned by the player, exactly like a
 * character sheet: the narrator reads a place every turn and never writes one,
 * so this screen is the only way a place changes after it is authored.
 *
 * Slim by design: what a place needs to give the narrator consistency now
 * mostly lives one level up, on the Scenario screen's world seed (tone,
 * factions, physical logic). This screen only ever remembers one specific
 * area — a name, a description, and the words that bring it to mind again.
 *
 * Every place is a closed `Collapsible`: an adventure accumulates them, each is
 * a long form, and the list is what the player came here to read. The one the
 * scene is in opens first and says so.
 */
export function PlacesScreen() {
  const places = useStore((s) => s.game.places);
  const area = useStore((s) => s.game.area);
  const addPlace = useStore((s) => s.addPlace);
  const removePlace = useStore((s) => s.removePlace);
  const here = findPlace(places, area);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-mono">
      <OverlayHeader title="Places" />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <FeatureOffNotice feature="places">
          The narrator no longer writes up areas or reads them back. Everything below is
          kept, and still yours to edit —
        </FeatureOffNotice>

        {places.length === 0 && (
          <p className="uppercase tracking-widest opacity-60">
            No places yet — one is written each time you travel somewhere new.
          </p>
        )}

        {places.map((place) => (
          <PlaceCard
            key={place.id}
            place={place}
            current={place.id === here?.id}
            onRemove={() => removePlace(place.id)}
          />
        ))}

        <button type="button" onClick={addPlace} className={`w-full ${btn}`}>
          + Add Place
        </button>
      </div>
    </main>
  );
}

function PlaceCard({
  place,
  current,
  onRemove,
}: {
  place: Place;
  current: boolean;
  onRemove: () => void;
}) {
  const updatePlace = useStore((s) => s.updatePlace);
  const writePlace = useStore((s) => s.writePlace);
  const pending = useStore((s) => s.placePending);
  const { ask, dialog } = useConfirm();

  const label = place.name.trim() || "Unnamed place";
  const heading = `${current ? "▸ " : ""}${label}${place.pending ? " (name only)" : ""}`;

  return (
    <Collapsible label={heading} defaultOpen={current}>
      <TextField
        label="Name"
        value={place.name}
        placeholder="Rodstroke"
        onChange={(v) => updatePlace(place.id, { name: v })}
      />
      <TextField
        label="Also Known As (comma-separated)"
        value={(place.aliases ?? []).join(", ")}
        placeholder="the village, Rodstroke-on-Wend"
        onChange={(v) => updatePlace(place.id, { aliases: splitList(v) })}
      />

      <AreaField
        label="Description"
        value={place.description}
        rows={4}
        placeholder="What it looks like, what it is like to be there, what is going on."
        onChange={(v) => updatePlace(place.id, { description: v })}
      />

      <TextField
        label="Extra Keywords (comma-separated)"
        value={place.keywords.join(", ")}
        placeholder="the village, Wend, Mayor Halloway"
        onChange={(v) => updatePlace(place.id, { keywords: splitList(v) })}
      />

      <div className="flex flex-wrap gap-2 border-t-2 border-ink pt-3">
        <button
          type="button"
          disabled={pending || !place.name.trim()}
          onClick={() => {
            // Rewriting throws away whatever is there, including hand edits, so
            // it asks — unlike the automatic first write, which only ever fills
            // a stub that has nothing in it yet.
            if (place.pending) {
              void writePlace(place.id);
              return;
            }
            ask(
              {
                title: `Rewrite ${label}?`,
                body: "The model writes this place again from scratch. Anything typed here is replaced.",
                confirmLabel: "Rewrite",
              },
              () => void writePlace(place.id),
            );
          }}
          className={btnSmall}
        >
          {pending ? "Writing…" : place.pending ? "Write With Model" : "Rewrite With Model"}
        </button>
        <button
          type="button"
          onClick={() =>
            ask({ title: `Delete ${label}?`, confirmLabel: "Delete" }, onRemove)
          }
          className={btnSmall}
        >
          Delete
        </button>
      </div>
      {dialog}
    </Collapsible>
  );
}

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
