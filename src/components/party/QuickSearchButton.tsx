import { useEffect, useRef, useState } from "react";
import { Box, IconButton, Text } from "theme-ui";

import ReferenceOpenIcon from "../../icons/ReferenceOpenIcon";
import ReferenceClosedIcon from "../../icons/ReferenceClosedIcon";
import { useFloatingWindow } from "../../contexts/FloatingWindowContext";
import {
  RULE_SYSTEMS,
  RULE_SYSTEM_LABEL,
  RuleSystem,
  setRuleSystem,
  useRuleSystem,
} from "../../helpers/ruleSystem";

const DESCRIPTION: Record<RuleSystem, string> = {
  "5e": "5etools 资料（2014 版优先）、怪物拖入、5e 状态",
  "5r": "5etools 资料（2024 修订版优先并高亮）、怪物拖入、5r 状态",
  pf2: "PF2 中文维基资料、生物拖入、PF2 状态",
  "4e": "4e Wiki 资料（威能、专长、物品…）、4e 状态",
};

/**
 * The rules mode: off, 5e, PF2 or 4e (one at a time). It turns on the
 * search bar for those rules, the conditions in the token menu and party
 * panel, and the monster card entries. A click opens the choice.
 */
function QuickSearchButton() {
  const { isOpen, setIsOpen } = useFloatingWindow("quickSearch");
  const system = useRuleSystem();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // A click elsewhere or Escape closes the choice
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function choose(choice: RuleSystem | null) {
    if (choice) {
      setRuleSystem(choice);
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
    setMenuOpen(false);
  }

  const current = isOpen ? RULE_SYSTEM_LABEL[system] : "";
  return (
    <Box ref={rootRef} sx={{ position: "relative" }}>
      <IconButton
        m={1}
        aria-label="Rules Mode"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={isOpen ? `规则模式：${current}（点击切换）` : "规则模式：关闭（点击选择 5e / 5r / PF2 / 4e）"}
        onClick={() => setMenuOpen((open) => !open)}
        sx={{ color: isOpen ? "primary" : "text", position: "relative" }}
      >
        {isOpen ? <ReferenceOpenIcon /> : <ReferenceClosedIcon />}
        {isOpen && (
          <Text
            as="span"
            sx={{
              position: "absolute",
              right: "-4px",
              bottom: "-2px",
              fontSize: "9px",
              fontWeight: "bold",
              lineHeight: 1,
              px: "2px",
              borderRadius: "3px",
              bg: "primary",
              color: "background",
            }}
          >
            {current}
          </Text>
        )}
      </IconButton>
      {menuOpen && (
        <Box
          role="menu"
          aria-label="规则模式"
          sx={{
            position: "absolute",
            left: "100%",
            bottom: 0,
            ml: 1,
            minWidth: "230px",
            bg: "background",
            border: "1px solid",
            borderColor: "border",
            borderRadius: "6px",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
            p: 1,
            zIndex: 60,
          }}
        >
          <MenuItem active={!isOpen} label="关闭" description="不显示资料搜索栏和规则状态" onClick={() => choose(null)} />
          {RULE_SYSTEMS.map((s) => (
            <MenuItem
              key={s}
              active={isOpen && system === s}
              label={RULE_SYSTEM_LABEL[s]}
              description={DESCRIPTION[s]}
              onClick={() => choose(s)}
            />
          ))}
          <Text sx={{ display: "block", fontSize: 0, color: "gray", px: 1, pt: 1 }}>
            Ctrl+K 打开当前模式的搜索栏
          </Text>
        </Box>
      )}
    </Box>
  );
}

function MenuItem({
  active,
  label,
  description,
  onClick,
}: {
  active: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <Box
      as="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      sx={{
        display: "block",
        width: "100%",
        textAlign: "left",
        bg: active ? "highlight" : "transparent",
        border: "none",
        borderRadius: "4px",
        color: "text",
        cursor: "pointer",
        px: 2,
        py: 1,
        "&:hover": { bg: "highlight" },
      }}
    >
      <Text sx={{ display: "block", fontSize: 1, fontWeight: "bold", color: active ? "primary" : "text" }}>
        {active ? "● " : ""}
        {label}
      </Text>
      <Text sx={{ display: "block", fontSize: 0, color: "gray" }}>{description}</Text>
    </Box>
  );
}

export default QuickSearchButton;
