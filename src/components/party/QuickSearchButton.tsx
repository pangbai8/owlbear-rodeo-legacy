import { IconButton } from "theme-ui";

import ReferenceOpenIcon from "../../icons/ReferenceOpenIcon";
import ReferenceClosedIcon from "../../icons/ReferenceClosedIcon";
import { useFloatingWindow } from "../../contexts/FloatingWindowContext";

/** Turns 5e mode on or off: the 5etools search bar and the 5e lookups */
function QuickSearchButton() {
  const { isOpen, toggle } = useFloatingWindow("quickSearch");

  return (
    <IconButton
      m={1}
      aria-label={isOpen ? "Turn Off 5e Mode" : "Turn On 5e Mode"}
      title={
        isOpen
          ? "关闭 5e 模式"
          : "开启 5e 模式：资料搜索栏（Ctrl+K）、面板标签查资料、怪物资料卡"
      }
      aria-pressed={isOpen}
      onClick={toggle}
      sx={{ color: isOpen ? "primary" : "text" }}
    >
      {isOpen ? <ReferenceOpenIcon /> : <ReferenceClosedIcon />}
    </IconButton>
  );
}

export default QuickSearchButton;
