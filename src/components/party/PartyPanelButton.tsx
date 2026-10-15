import { IconButton } from "theme-ui";

import PartyPanelIcon from "../../icons/PartyPanelIcon";
import { useFloatingWindow } from "../../contexts/FloatingWindowContext";

function PartyPanelButton() {
  const { isOpen, toggle } = useFloatingWindow("partyPanel");

  return (
    <IconButton
      m={1}
      aria-label={isOpen ? "Hide Party Status" : "Show Party Status"}
      title={isOpen ? "隐藏小队状态" : "小队状态"}
      aria-pressed={isOpen}
      onClick={toggle}
      sx={{ color: isOpen ? "primary" : "text" }}
    >
      <PartyPanelIcon />
    </IconButton>
  );
}

export default PartyPanelButton;
