import { useStore } from "../store";
import { GenerateModal } from "./GenerateModal";
import type { GeneratedItem, ItemRow } from "../lib/generateItem";
import type { Character } from "../types";

/**
 * The ✦ generate modal for one inventory / equipment ROW. The exchange itself
 * lives in `GenerateModal`, shared with the member sheet's prose fields and the
 * Scenario screen; this binds it to a row of gear.
 *
 * Both callers are Edit-gated screens, so an accepted item lands in their draft
 * and Discard Changes is the undo — the same deal the member sheet's ✦ fields
 * get, and the reason the button only appears in Edit mode.
 */
export function GenerateItemModal({
  existing,
  character,
  replacing,
  onAccept,
  onClose,
}: {
  /** The list being added to, without the row being written. */
  existing: ItemRow[];
  /** Set when this is a character's kit; absent for the shared pack. */
  character?: Character;
  /** The row already has something in it, so accepting overwrites it. */
  replacing: boolean;
  onAccept: (item: GeneratedItem) => void;
  onClose: () => void;
}) {
  const run = useStore((s) => s.generateItem);
  const who = character?.name.trim() || "this character";

  return (
    <GenerateModal<GeneratedItem>
      label={character ? "Equipment" : "Item"}
      blurb={
        character
          ? `The model writes one piece of gear for ${who} from their sheet, what they already carry, the scenario, and any world notes they touch.`
          : "The model writes one item from the scenario, what the party already carries, and any world notes they touch."
      }
      replacing={replacing}
      replacingNote="Replaces this row's name, description and count. Discard Changes still undoes it."
      run={(hint) => run(hint, existing, character)}
      preview={(item) => (
        <>
          <span className="font-bold">{item.label}</span>
          {item.quantity > 1 && <span className="tabular-nums"> × {item.quantity}</span>}
          {item.description && `\n${item.description}`}
        </>
      )}
      onAccept={onAccept}
      onClose={onClose}
    />
  );
}
