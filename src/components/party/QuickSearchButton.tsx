import { IconButton } from "theme-ui";

import ReferenceOpenIcon from "../../icons/ReferenceOpenIcon";
import ReferenceClosedIcon from "../../icons/ReferenceClosedIcon";
import { useFloatingWindow } from "../../contexts/FloatingWindowContext";

function QuickSearchButton() {
  const { isOpen, toggle } = useFloatingWindow("quickSearch");

  return (
    <IconButton
      m={1}
      aria-label={isOpen ? "Hide 5e Search" : "Show 5e Search"}
      title={isOpen ? "收起 5e 资料搜索栏" : "显示 5e 资料搜索栏（Ctrl+K）"}
      aria-pressed={isOpen}
      onClick={toggle}
      sx={{ color: isOpen ? "primary" : "text" }}
    >
      {isOpen ? <ReferenceOpenIcon /> : <ReferenceClosedIcon />}
    </IconButton>
  );
}

export default QuickSearchButton;
