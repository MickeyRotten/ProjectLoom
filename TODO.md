# TODO — deferred audit findings

From the 2026-07 code/UX/player-experience audit. The critical + high items
(roster-wiping New Adventure, input-eating failed turns, save migration, quest
`status` in the protocol, PC traits in the prompt, model party-add cap,
mid-stream error frames, turn abort) were fixed on
`claude/code-ux-player-audit-bnq45q`. The rest live here, roughly by impact.

## UX

_All items below fixed on `claude/todo-review-1jt4uv`._

- [x] **Auto-scroll yanks during streaming** — `ChatView.tsx` scrolls to bottom
  on every `streamText` delta; scrolling up to reread gets dragged back every
  chunk. Only auto-scroll when already near the bottom. **Fixed:** tail-follow
  only when within 120px of the bottom.
- [x] **Undo is instant, irreversible, and adjacent to Regenerate** —
  `TurnControls.tsx`: two thumb-width buttons side by side, no confirm, no redo.
  Fat-finger Undo on mobile = turn gone. Confirm on Undo, or keep a one-level
  redo buffer. **Fixed:** `confirm()` gate on Undo.
- [x] **No visible focus style** — inputs/buttons use `focus:outline-none` with
  no replacement (`fields.tsx`, `Composer.tsx`, all screens). Keyboard/switch
  users navigate blind. Add a `focus-visible:` ring (2px ink offset fits the
  1-bit look). **Fixed:** global `:focus-visible` 2px ink ring in `theme.css`.
- [x] **Empty party slot looks tappable** — the dashed `+` box in
  `PartyStrip.tsx` reads as "tap to add" but is a dead `aria-hidden` div. Make
  it open Characters/add-member, or drop the `+` glyph. **Fixed:** empty slot is
  now a button that opens the Characters screen.
- [x] **First-run dead end without a key** — LOOK fires a turn that errors;
  nothing routes the player to ☰ → Model & Key. Gate LOOK on a key + make the
  error/empty state link to the screen. Error copy also says "Settings" while
  the menu item is "Model & Key" (`openrouter.ts`). **Fixed:** LOOK disabled
  without a key, error state links to Model & Key, copy corrected.
- [x] **PC portrait only generates after opening the PC sheet** —
  `syncImages` (`store.ts`) skips the PC; the strip shows initials until the
  sheet is opened once. Include the PC in `syncImages`. **Fixed:** PC portrait
  synced up front.
- [x] **Orphaned image blobs accumulate** — `deleteImage` (`db.ts`) is never
  called. Deleted members and abandoned locations leave blobs in IndexedDB
  forever. Delete the portrait blob on member delete; consider a banner LRU.
  **Fixed:** portrait blob + object URL freed on member delete. (Banner LRU
  still deferred.)
- [x] **`startDay` edit doesn't retarget the live day** — `updateScenario`
  (`store.ts`) retargets `location` when `startLocation` changes but leaves
  `day` when `startDay` changes. Same rule both or neither. **Fixed:** `startDay`
  retargets the live day, same as location.
- [x] **Edit-image modal traps + silent failure** — `EditImageButton.tsx`: no
  Escape, no backdrop dismiss; and a failed edit is swallowed (`editImage` in
  `store.ts`) so the pending state just ends with nothing changed. Add dismiss
  affordances + a small "edit failed" indicator. **Fixed:** Escape + backdrop
  dismiss; `imgError` state drives an "edit failed" badge on banner/portrait.
- [x] **`<html class="dark">` is dead** — `index.html` sets `dark` but the theme
  flips on `.invert` (`theme.css`), so the app ships black-on-white despite
  `theme-color #000000`. Fix the class or remove it — and expose the invert
  toggle in the UI (cheap win). **Fixed:** dead class removed, `settings.invert`
  toggle in the menu drives `.invert` + matching `theme-color`.

## Heuristics / polish

- [ ] **Stopword first names false-address** — `namePattern` (`spotlight.ts`)
  includes the first name token; a member called "The Butcher" makes every
  "the" count as addressing them. Drop the first-token form when it's a
  stopword.
- [ ] **`"Run," Bob's mother urged` credits Bob** — `memberSpoke` pattern
  `,\s*["""]\s*Name` (`spotlight.ts`) misfires on possessive attribution.
  Known heuristic trade-off; tighten if it shows up in play.
- [ ] **`*_CONTEXT_TURNS` count messages, not turns** — `prompt.ts` slices
  `-N` messages, i.e. half the intended turns. Slice `-N*2` or rename.
- [ ] **`snake_case` renders italic** — `markdown.ts` `_` delimiter matches
  mid-word. Require word boundaries for `_`/`__`.
- [ ] **Mid-stream authoring edits can be reverted by Undo** — the reversal is
  captured against the pre-turn snapshot (`store.ts` `sendTurn`), so edits made
  in menu screens while a turn streams get silently undone. Cheapest fix:
  block authoring screens while streaming.
- [ ] **Oversize newest beat drops the whole history tail** — `buildHistory`
  (`prompt.ts`) can end up with only the opening narration if the newest turn
  alone exceeds the budget. Always keep the newest turn regardless.

## Product decision

- [ ] **Default instructions are explicit + CI ships a signed APK** — the
  ship-default narrator/portrait instructions (`defaults.ts`) steer toward
  adult content out of the box. Google Play would reject it, and many
  OpenRouter models will refuse mid-stream (now surfaced as stream errors, but
  still a confusing player experience). Decide: tame defaults with the current
  text as an opt-in preset, or accept sideload-only distribution.
