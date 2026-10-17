import { IconButton } from "theme-ui";

import SpellBarIcon from "../../icons/SpellBarIcon";
import { useFloatingWindow } from "../../contexts/FloatingWindowContext";

/** Shows or hides the favourites bar (收藏栏: favourite spells, attacks and saves) */
function SpellBarButton() {
  const { isOpen, toggle } = useFloatingWindow("spellBar");
  return (
    <IconButton
      m={1}
      aria-label={isOpen ? "Hide Favourites Bar" : "Show Favourites Bar"}
      title={isOpen ? "收起收藏栏" : "收藏栏：屏幕底部的快捷栏，收藏法术、攻击和豁免（每个规则模式各一套）"}
      aria-pressed={isOpen}
      onClick={toggle}
      sx={{ color: isOpen ? "primary" : "text" }}
    >
      <SpellBarIcon />
    </IconButton>
  );
}

export default SpellBarButton;
