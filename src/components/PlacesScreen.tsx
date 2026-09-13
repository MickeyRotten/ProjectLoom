import { useState } from "react";
import type { Place } from "../types";
import { useStore } from "../store";
import { findPlace } from "../lib/places";
import { FeatureOffNotice } from "./FeatureOffNotice";
import {
  MaterialHeader,
  card,
  fieldLabel,
  filledInput,
  filledTextarea,
  pillDanger,
  pillOutline,
} from "./material";
import { useConfirm } from "./useConfirm";

/**
 * Places — the areas this adventure knows (DESIGN.md → Places). Material
 * redesign (`Loom Material Redesign.dc.html`): each place a filled surface
 * card, collapsed by default the same way the reorderable block cards fold
 * away what a screen doesn't need shown right now.
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
 * Every place starts closed: an adventure accumulates them, each is a long
 * form, and the list is what the player came here to read. The one the scene
 * is in opens first and says so.
 */
export function PlacesScreen() {
  const places = useStore((s) => s.game.places);
  const area = useStore((s) => s.game.area);
  const addPlace = useStore((s) => s.addPlace);
  const removePlace = useStore((s) => s.removePlace);
  const here = findPlace(places, area);

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
      <MaterialHeader title="Places" back />

      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-6">
        <FeatureOffNotice feature="places">
          The narrator no longer writes up areas or reads them back. Everything below is
          kept, and still yours to edit —
        </FeatureOffNotice>

        {places.length === 0 && (
          <p className="text-[13px] text-[var(--m-text-55)]">
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

        <button type="button" onClick={addPlace} className={`w-full ${pillOutline}`}>
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
  const [open, setOpen] = useState(current);

  const label = place.name.trim() || "Unnamed place";

  return (
    <div className={card}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <span className="min-w-0 flex-1 text-[15px] font-medium">
          {current && <span className="text-[var(--m-text-55)]">▸ </span>}
          {label}
          {place.pending && (
            <span className="ml-1.5 text-[12px] font-normal text-[var(--m-text-40)]">
              (name only)
            </span>
          )}
        </span>
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="var(--m-outline)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="mt-3.5 space-y-3">
          <div className="space-y-1">
            <span className={fieldLabel}>Name</span>
            <input
              value={place.name}
              placeholder="Rodstroke"
              onChange={(e) => updatePlace(place.id, { name: e.target.value })}
              className={filledInput}
            />
          </div>

          <div className="space-y-1">
            <span className={fieldLabel}>Also Known As (comma-separated)</span>
            <input
              value={(place.aliases ?? []).join(", ")}
              placeholder="the village, Rodstroke-on-Wend"
              onChange={(e) => updatePlace(place.id, { aliases: splitList(e.target.value) })}
              className={filledInput}
            />
          </div>

          <div className="space-y-1">
            <span className={fieldLabel}>Description</span>
            <textarea
              value={place.description}
              rows={4}
              placeholder="What it looks like, what it is like to be there, what is going on."
              onChange={(e) => updatePlace(place.id, { description: e.target.value })}
              className={filledTextarea}
            />
          </div>

          <div className="space-y-1">
            <span className={fieldLabel}>Extra Keywords (comma-separated)</span>
            <input
              value={place.keywords.join(", ")}
              placeholder="the village, Wend, Mayor Halloway"
              onChange={(e) => updatePlace(place.id, { keywords: splitList(e.target.value) })}
              className={filledInput}
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
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
              className={pillOutline}
            >
              {pending ? "Writing…" : place.pending ? "Write With Model" : "Rewrite With Model"}
            </button>
            <button
              type="button"
              onClick={() => ask({ title: `Delete ${label}?`, confirmLabel: "Delete" }, onRemove)}
              className={pillDanger}
            >
              Delete
            </button>
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
