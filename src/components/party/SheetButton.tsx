import { IconButton } from "theme-ui";

import SheetIcon from "../../icons/SheetIcon";
import { sheetEditorUrl } from "../SheetWindow";
import { useFloatingWindow } from "../../contexts/FloatingWindowContext";

function SheetButton() {
  const { isOpen, toggle } = useFloatingWindow("sheets");

  if (!sheetEditorUrl) {
    return null;
  }

  return (
    <IconButton
      m={1}
      aria-label={isOpen ? "Hide Character Sheets" : "Show Character Sheets"}
      title={isOpen ? "Hide Character Sheets" : "Show Character Sheets"}
      aria-pressed={isOpen}
      onClick={toggle}
      sx={{ color: isOpen ? "primary" : "text" }}
    >
      <SheetIcon />
    </IconButton>
  );
}

export default SheetButton;
