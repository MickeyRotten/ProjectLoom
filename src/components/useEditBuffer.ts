import { useState } from "react";

/**
 * Local edit buffer for the edit-mode-gated screens (Quests, Inventory, Character
 * sheet). While not editing, a screen renders straight from `source`; `startEdit`
 * snapshots it into a draft, `save` commits the draft via `commit`, `discard`
 * throws it away. Leaving the screen unmounts the component, which drops the
 * buffer — so navigating away toggles edit off and reverts any pending changes
 * for free.
 */
export function useEditBuffer<T>(source: T, commit: (draft: T) => void) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(source);
  return {
    editing,
    draft,
    setDraft,
    startEdit: () => {
      setDraft(source);
      setEditing(true);
    },
    save: () => {
      commit(draft);
      setEditing(false);
    },
    discard: () => {
      setDraft(source);
      setEditing(false);
    },
  };
}
