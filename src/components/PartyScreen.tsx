import { useMemo } from "react";
import { useStore } from "../store";
import type { PartyMember } from "../types";
import { FeatureOffNotice } from "./FeatureOffNotice";
import { MaterialHeader, pillOutline, sectionHeading } from "./material";
import { PARTY_LIMIT, activeMembers, benchedMembers, playerCharacter } from "../lib/roster";
import { firstBlockText } from "../lib/blocks";
import { portraitKey } from "../lib/images";

/**
 * Full-screen PARTY view (Material redesign — DESIGN.md, `Loom Material
 * Redesign.dc.html`) — the player character up top (never absent from the
 * scene, so no standing to move and nothing to kick), then the company in two
 * halves: who is in the scene (capped at PARTY_LIMIT companions) and who is
 * BENCHED, still one of yours but waiting elsewhere.
 *
 * Rows are pure navigation now — avatar, name, one line of context, chevron —
 * the Bench/Activate/Kick buttons that used to sit on each row moved onto the
 * member's own sheet as the "Standing this adventure" chips, matching the
 * mock-up's read/edit pencil pattern everywhere else. The bottom nav (peer of
 * Play now) stays visible under this screen, so there is no Back button.
 */
export function PartyScreen() {
  const characters = useStore((s) => s.game.characters);
  const roster = useStore((s) => s.game.roster);
  const openMember = useStore((s) => s.openMember);
  const setScreen = useStore((s) => s.setScreen);
  const images = useStore((s) => s.images);

  const pc = useMemo(() => playerCharacter(characters, roster), [characters, roster]);
  const active = useMemo(() => activeMembers(characters, roster), [characters, roster]);
  const benched = useMemo(() => benchedMembers(characters, roster), [characters, roster]);
  const detail = (m: PartyMember) => {
    const strengths = firstBlockText(m.blocks, "strengths");
    return [m.species, strengths].filter(Boolean).join(" · ");
  };

  const row = (m: PartyMember) => (
    <button
      key={m.id}
      type="button"
      onClick={() => openMember(m.id)}
      className="flex min-h-11 w-full items-center gap-3.5 rounded-[10px] px-1 py-2.5 text-left active:bg-[var(--m-surface)]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--m-avatar)] text-[15px] font-semibold">
        {images[portraitKey(m.id)] ? (
          <img
            src={images[portraitKey(m.id)]}
            alt=""
            className="h-full w-full origin-top scale-150 object-cover object-top"
          />
        ) : (
          (m.name[0] ?? "?").toUpperCase()
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{m.name || "(unnamed)"}</span>
        <span className="block truncate text-[12.5px] text-[var(--m-text-55)]">{detail(m)}</span>
      </span>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--m-outline)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
      <MaterialHeader title={`Party ${active.length}/${PARTY_LIMIT}`} />

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <FeatureOffNotice feature="characters">
          The narrator no longer adds, renames or dismisses anyone — the party is yours
          to assemble on the Characters screen —
        </FeatureOffNotice>

        {pc && (
          <>
            <p className={sectionHeading}>Player</p>
            {row(pc)}
          </>
        )}

        {active.length === 0 && benched.length === 0 && (
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-[var(--m-text-55)]">No one is travelling with you.</p>
            <button type="button" onClick={() => setScreen("characters")} className={`w-full ${pillOutline}`}>
              Go to Characters
            </button>
          </div>
        )}

        {active.length > 0 && (
          <p className={sectionHeading}>In the scene {active.length}/{PARTY_LIMIT}</p>
        )}
        {active.map(row)}

        {benched.length > 0 && <p className={sectionHeading}>Benched</p>}
        {benched.map(row)}
      </div>
    </main>
  );
}
