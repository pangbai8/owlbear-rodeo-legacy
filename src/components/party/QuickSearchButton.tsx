import { IconButton } from "theme-ui";

import ReferenceOpenIcon from "../../icons/ReferenceOpenIcon";
import ReferenceClosedIcon from "../../icons/ReferenceClosedIcon";
import Pf2Icon from "../../icons/Pf2Icon";
import { useFloatingWindow } from "../../contexts/FloatingWindowContext";
import {
  RuleSystem,
  setRuleSystem,
  useRuleSystem,
} from "../../helpers/ruleSystem";

const TITLES: Record<RuleSystem, { on: string; off: string; label: string }> = {
  "5e": {
    on: "关闭 5e 模式",
    off: "开启 5e 模式：资料搜索栏（Ctrl+K）、面板标签查资料、怪物资料卡",
    label: "5e Mode",
  },
  pf2: {
    on: "关闭 PF2 模式",
    off: "开启 PF2 模式：PF2 资料搜索栏（Ctrl+K）、面板标签查资料、怪物资料卡",
    label: "PF2 Mode",
  },
};

/**
 * Turns a rule system's reference tools on or off. 5e and PF2 share the
 * search bar, so turning one on turns the other off.
 */
function RuleSystemButton({ system }: { system: RuleSystem }) {
  const { isOpen, setIsOpen } = useFloatingWindow("quickSearch");
  const current = useRuleSystem();
  const active = isOpen && current === system;
  const titles = TITLES[system];

  function toggle() {
    if (active) {
      setIsOpen(false);
    } else {
      setRuleSystem(system);
      setIsOpen(true);
    }
  }

  return (
    <IconButton
      m={1}
      aria-label={active ? `Turn Off ${titles.label}` : `Turn On ${titles.label}`}
      title={active ? titles.on : titles.off}
      aria-pressed={active}
      onClick={toggle}
      sx={{ color: active ? "primary" : "text" }}
    >
      {system === "pf2" ? (
        <Pf2Icon />
      ) : active ? (
        <ReferenceOpenIcon />
      ) : (
        <ReferenceClosedIcon />
      )}
    </IconButton>
  );
}

function QuickSearchButton() {
  return (
    <>
      <RuleSystemButton system="5e" />
      <RuleSystemButton system="pf2" />
    </>
  );
}

export default QuickSearchButton;
