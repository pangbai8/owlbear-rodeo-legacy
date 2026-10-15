import { IconButton } from "theme-ui";

import SearchIcon from "../../icons/SearchIcon";
import { useFloatingWindow } from "../../contexts/FloatingWindowContext";

/** Shows or hides the 5e quick search bar at the top of the game page */
function QuickSearchButton() {
  const { isOpen, toggle } = useFloatingWindow("quickSearch");

  return (
    <IconButton
      m={1}
      aria-label={isOpen ? "Hide 5e Search" : "Show 5e Search"}
      title={isOpen ? "隐藏 5e 资料搜索" : "5e 资料搜索（Ctrl+K）"}
      aria-pressed={isOpen}
      onClick={toggle}
      sx={{ color: isOpen ? "primary" : "text" }}
    >
      <SearchIcon />
    </IconButton>
  );
}

export default QuickSearchButton;
