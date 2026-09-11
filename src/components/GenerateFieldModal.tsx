import { useStore } from "../store";
import { GenerateModal } from "./GenerateModal";
import type { Block, Character } from "../types";

/**
 * Per-block generate modal for the member sheet (✦). The exchange itself lives
 * in `GenerateModal`, shared with the Scenario screen's ✦ buttons; this binds it
 * to one Text block on one character's sheet.
 *
 * The character passed in is the sheet's EDIT DRAFT, so the generation reads
 * what the player has typed this session, not what was last saved. Accepting
 * writes back into that draft; Save Changes on the sheet is what commits it.
 */
export function GenerateFieldModal({
  character,
  block,
  onAccept,
  onClose,
}: {
  character: Character;
  /** The Text block being written — its own current text decides `replacing`. */
  block: Pick<Block, "title" | "kind" | "text">;
  onAccept: (text: string) => void;
  onClose: () => void;
}) {
  const run = useStore((s) => s.generateField);
  const label = block.title.trim() || "this block";
  const name = character.name.trim() || "this character";

  return (
    <GenerateModal
      label={label}
      blurb={`The model writes ${label} for ${name} from their sheet — species and sex above all — the scenario, and any world notes they touch.`}
      replacing={!!block.text.trim()}
      replacingNote={`Replaces ${label} on the sheet. Discard Changes still undoes it.`}
      run={(hint) => run(character, block, hint)}
      onAccept={onAccept}
      onClose={onClose}
    />
  );
}
