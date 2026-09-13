import { useEffect, useState } from "react";
import { useStore, type Screen } from "../store";
import { MaterialHeader } from "./material";

/**
 * A settings screen that is an INDEX of sub-menus rather than one long scroll —
 * the shape Advanced proved and Narrator and Images now share.
 *
 * Why the depth is local state and not a `Screen`: the sub-menus are one
 * screen's internal structure, and routing them would put a dozen more entries
 * in the store's navigation history for no gain. What the store DOES own is the
 * Back claim (`setBackHandler`), because the Android hardware button has no way
 * to know about a component's `useState`, and the one-shot `section` deep link,
 * so a cross-reference elsewhere in the app can be a button instead of a
 * sentence telling the player which path to walk.
 */
export interface SubMenuSection {
  id: string;
  label: string;
  note: string;
  Body: () => React.ReactElement;
}

/**
 * Deep-link target meaning "the index of this screen, whatever sub-menu you are
 * in". Matches no section id, and `SubMenuScreen` resolves an unmatched link by
 * closing whatever is open.
 */
export const SUBMENU_INDEX = "";

export function SubMenuScreen({
  title,
  sections,
  header,
}: {
  title: string;
  sections: SubMenuSection[];
  /**
   * Controls rendered on the INDEX itself, above the rows — for the settings
   * that apply to every sub-menu below them (Images' master switch). Anything
   * scoped to one sub-menu belongs in that sub-menu.
   */
  header?: React.ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const setBackHandler = useStore((s) => s.setBackHandler);
  const pending = useStore((s) => s.section);
  const clearSection = useStore((s) => s.clearSection);
  const open = sections.find((s) => s.id === openId) ?? null;

  // Consume a deep link. A link always resolves to something: the section it
  // names, or — for `SUBMENU_INDEX`, and for a stale id naming no section here —
  // this index.
  useEffect(() => {
    if (pending === null) return;
    setOpenId(sections.some((s) => s.id === pending) ? pending : null);
    clearSection();
  }, [pending, sections, clearSection]);

  // Claim Back while a sub-menu is open, so it pops to this index rather than
  // out of the screen entirely.
  useEffect(() => {
    if (!open) return;
    setBackHandler(() => {
      setOpenId(null);
      return true;
    });
    return () => setBackHandler(null);
  }, [open, setBackHandler]);

  if (open) {
    const { Body } = open;
    return (
      <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
        <MaterialHeader title={open.label} back />
        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-6">
          <Body />
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-full flex-col bg-paper text-ink font-alata">
      <MaterialHeader title={title} back />
      <div className="flex-1 space-y-2.5 overflow-y-auto px-4 pb-6">
        {header}
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setOpenId(s.id)}
            className="block min-h-11 w-full rounded-[14px] bg-[var(--m-surface)] px-4 py-3 text-left"
          >
            <div className="text-[15px] font-medium">{s.label}</div>
            <div className="mt-0.5 text-[12.5px] text-[var(--m-text-55)]">{s.note}</div>
          </button>
        ))}
      </div>
    </main>
  );
}

/**
 * A tappable cross-reference to another screen, or to another sub-menu of the
 * one you're on. The settings copy used to name paths in prose — "switched off
 * under Menu → Model & Key", "counts against Advanced → Narrator → Beat Length
 * Limit" — which told the player where to go and then made them walk it. Six of
 * those existed, and every one of them went stale the moment a screen moved.
 */
export function MenuLink({
  screen,
  section,
  children,
}: {
  screen: Screen;
  section?: string;
  children: React.ReactNode;
}) {
  const setScreen = useStore((s) => s.setScreen);
  return (
    <button
      type="button"
      onClick={() => setScreen(screen, section)}
      className="underline underline-offset-2"
    >
      {children}
    </button>
  );
}
