import type { Place, Room } from "../types";
import { useStore } from "../store";
import {
  MAX_ROOMS,
  PLACE_KINDS,
  findPlace,
  kindDef,
  placeHeading,
  setTagValues,
  slotsOf,
  tagValues,
} from "../lib/places";
import { OverlayHeader } from "./OverlayHeader";
import { FeatureOffNotice } from "./FeatureOffNotice";
import { AreaField, Collapsible, ReadBlock, SegmentedRow, TextField, btn, btnSmall } from "./fields";
import { useConfirm } from "./useConfirm";

/**
 * Places — the areas this adventure knows (DESIGN.md → Places).
 *
 * Written by the arrival call and then owned by the player, exactly like a
 * character sheet: the narrator reads a place every turn and never writes one,
 * so this screen is the only way a place changes after it is authored.
 *
 * Every place is a closed `Collapsible`: an adventure accumulates them, each is
 * a long form, and the list is what the player came here to read. The one the
 * scene is in opens first and says so.
 *
 * The KIND picker is the load-bearing control. It decides which tag slots exist
 * (`places.ts → PLACE_KINDS`), so switching it re-draws the form and drops tags
 * the new kind has no slot for — which is the honest behaviour: prosperity on a
 * swamp was never going to be printed.
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

  const def = kindDef(place.kind);
  const label = place.name.trim() || "Unnamed place";
  const heading = `${current ? "▸ " : ""}${place.name.trim() ? placeHeading(place) : label}${
    place.pending ? " (name only)" : ""
  }`;

  const setRooms = (rooms: Room[]) => updatePlace(place.id, { rooms });

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
      <ReadBlock
        label="Position"
        value={`(${place.coords.x}, ${place.coords.y}, ${place.coords.z})`}
      />
      {place.locations.length > 0 && (
        <ReadBlock
          label="Known Points"
          value={place.locations
            .map((p) => `${p.name} (${p.coords.x}, ${p.coords.y}, ${p.coords.z})`)
            .join("\n")}
        />
      )}

      {/* Changing the kind changes which slots exist, so the tags are rebuilt
          against the new schema — `normalizePlace` would drop the orphans on the
          next read anyway, and doing it here keeps the form honest. */}
      <SegmentedRow
        label="Kind"
        value={place.kind}
        options={PLACE_KINDS.map((k) => ({ value: k.id, label: k.label }))}
        onChange={(kind) =>
          updatePlace(place.id, {
            kind,
            tags: place.tags.filter((t) => slotsOf(kind).some((s) => s.key === t.slot)),
          })
        }
      />

      <TextField
        label="Type"
        value={place.type}
        placeholder={def.types.slice(0, 4).join(" · ")}
        onChange={(v) => updatePlace(place.id, { type: v })}
      />

      <AreaField
        label="Description"
        value={place.description}
        rows={4}
        placeholder="What it looks like, what it is like to be there, what is going on."
        onChange={(v) => updatePlace(place.id, { description: v })}
      />

      {slotsOf(place.kind).map((slot) => (
        <TextField
          key={slot.key}
          label={slot.single ? slot.label : `${slot.label} (comma-separated)`}
          value={tagValues(place, slot.key).join(", ")}
          placeholder={slot.options?.slice(0, 4).join(" · ") ?? slot.hint}
          onChange={(v) =>
            updatePlace(place.id, {
              tags: setTagValues(place, slot.key, slot.single ? [v] : splitList(v)),
            })
          }
        />
      ))}

      <AreaField
        label="Rumours (one per line)"
        value={place.rumours.join("\n")}
        rows={3}
        placeholder="Believed locally — they do not have to be true."
        onChange={(v) => updatePlace(place.id, { rumours: splitLines(v) })}
      />

      <TextField
        label="Extra Keywords (comma-separated)"
        value={place.keywords.join(", ")}
        placeholder="the village, Wend, Mayor Halloway"
        onChange={(v) => updatePlace(place.id, { keywords: splitList(v) })}
      />

      <div className="space-y-2">
        <p className="uppercase tracking-widest text-sm">{def.roomLabel}</p>
        {place.rooms.length === 0 && <p className="text-sm opacity-60">None yet.</p>}
        {place.rooms.map((room, i) => (
          <div key={i} className="space-y-2 border-2 border-ink p-2">
            <TextField
              label="Name"
              value={room.name}
              onChange={(v) => setRooms(patchRoom(place.rooms, i, { name: v }))}
            />
            <TextField
              label="Description"
              value={room.description}
              onChange={(v) => setRooms(patchRoom(place.rooms, i, { description: v }))}
            />
            <div className="flex flex-wrap gap-2">
              {/* One of / recurring, as a two-state button rather than a
                  checkbox: it is the only thing distinguishing the two lists the
                  narrator is shown, and it reads better as a label than as a
                  tick nobody notices. */}
              <button
                type="button"
                onClick={() => setRooms(patchRoom(place.rooms, i, { unique: !room.unique }))}
                className={btnSmall}
              >
                {room.unique ? "One of these" : "Recurring"}
              </button>
              <button
                type="button"
                onClick={() => setRooms(place.rooms.filter((_, j) => j !== i))}
                className={btnSmall}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {place.rooms.length < MAX_ROOMS && (
          <button
            type="button"
            onClick={() => setRooms([...place.rooms, { name: "", description: "" }])}
            className={`w-full ${btnSmall}`}
          >
            + Add {def.roomLabel.replace(/s$/, "")}
          </button>
        )}
      </div>

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

function patchRoom(rooms: Room[], index: number, patch: Partial<Room>): Room[] {
  return rooms.map((r, i) => (i === index ? { ...r, ...patch } : r));
}

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const splitLines = (value: string): string[] =>
  value
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
