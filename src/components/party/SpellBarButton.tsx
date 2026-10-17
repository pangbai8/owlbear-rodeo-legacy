import { IconButton } from "theme-ui";

import SpellBarIcon from "../../icons/SpellBarIcon";
import { useFloatingWindow } from "../../contexts/FloatingWindowContext";

/** Shows or hides the spell bar (favourite spells and attacks) */
function SpellBarButton() {
  const { isOpen, toggle } = useFloatingWindow("spellBar");
  return (
    <IconButton
      m={1}
      aria-label={isOpen ? "Hide Spell Bar" : "Show Spell Bar"}
      title={isOpen ? "收起法术栏" : "法术栏：屏幕底部的快捷栏，收藏法术、攻击和豁免"}
      aria-pressed={isOpen}
      onClick={toggle}
      sx={{ color: isOpen ? "primary" : "text" }}
    >
      <SpellBarIcon />
    </IconButton>
  );
}

export default SpellBarButton;
