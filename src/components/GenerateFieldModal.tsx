import { useStore } from "../store";
import { GenerateModal } from "./GenerateModal";
import { GEN_FIELD_LABEL, type GenField } from "../lib/generateField";
import type { Character } from "../types";

/**
 * Per-field generate modal for the member sheet (✦). The exchange itself lives
 * in `GenerateModal`, shared with the Scenario screen's ✦ buttons; this binds it
 * to one character's sheet.
 *
 * The character passed in is the sheet's EDIT DRAFT, so the generation reads
 * what the player has typed this session, not what was last saved. Accepting
 * writes back into that draft; Save Changes on the sheet is what commits it.
 */
export function GenerateFieldModal({
  character,
  field,
  onAccept,
  onClose,
}: {
  character: Character;
  field: GenField;
  onAccept: (text: string) => void;
  onClose: () => void;
}) {
  const run = useStore((s) => s.generateField);
  const label = GEN_FIELD_LABEL[field];
  const name = character.name.trim() || "this character";

  return (
    <GenerateModal
      label={label}
      blurb={`The model writes ${label} for ${name} from their sheet — species and sex above all — the scenario, and any world notes they touch.`}
      replacing={!!character[field].trim()}
      replacingNote={`Replaces the ${label} on the sheet. Discard Changes still undoes it.`}
      run={(hint) => run(character, field, hint)}
      onAccept={onAccept}
      onClose={onClose}
    />
  );
}
