import React, { useState } from "react";
import { Box, Text } from "theme-ui";

import {
  Formula,
  Roll,
  RollSummary,
  TextPart,
  describeSummary,
  rollDice,
  rollExpression,
  rollFormula,
  summarizeFormula,
  summarizeRoll,
} from "../helpers/fiveEDice";
import { sendRollToBoluo } from "../helpers/boluo";
import { sendRollToDiscord } from "../helpers/discordBridge";
import { getRollTarget } from "../helpers/rollTarget";

/** boluo: where posting the roll to Boluo or Discord stands, or what went wrong */
type LoggedRoll = { id: number; label: string; result: RollSummary; boluo?: string };

let nextRollId = 1;

/**
 * Rolls from a card, kept as a short log on the card. speaker: the
 * monster whose card it is, named in the roll when it goes to Boluo.
 */
export function useDiceRoller(speaker?: string) {
  const [log, setLog] = useState<LoggedRoll[]>([]);

  function roll(label: string, dice: Roll) {
    addRoll(label, summarizeRoll(rollDice(dice)));
  }

  /** A typed formula, e.g. from the spell bar ("2d6+1d8+3") */
  function rollTyped(label: string, formula: Formula) {
    addRoll(label, summarizeFormula(rollFormula(formula)));
  }

  function addRoll(label: string, result: RollSummary) {
    const id = nextRollId++;
    const target = getRollTarget();
    setLog((prev) =>
      [{ id, label, result, boluo: target ? "发送中…" : undefined }, ...prev].slice(0, 4)
    );
    const setStatus = (boluo: string) =>
      setLog((prev) => prev.map((entry) => (entry.id === id ? { ...entry, boluo } : entry)));
    if (target === "boluo")
      sendRollToBoluo(speaker, label, result).then(
        ({ name, inGame }) => setStatus(`已发到 Boluo（${name}，${inGame ? "场内" : "场外"}）`),
        (error) => setStatus(`未发到 Boluo：${error.message}`)
      );
    else if (target === "discord")
      sendRollToDiscord(speaker, label, result).then(
        () => setStatus("已发到 Discord"),
        (error) => setStatus(`未发到 Discord：${error.message}`)
      );
  }

  return { log, roll, rollTyped };
}

export type DiceRoller = ReturnType<typeof useDiceRoller>;

/** Text with its rolls as buttons; label names what is rolled */
export function RollableText({
  parts,
  label,
  roller,
}: {
  parts: TextPart[];
  label: (part: Exclude<TextPart, string>, before: string) => string;
  roller: DiceRoller;
}) {
  let before = "";
  // PF2 text marks bold with **…**, which may run across a roll
  let bold = false;
  const wrap = (key: string, node: React.ReactNode) =>
    bold ? <b key={key}>{node}</b> : <React.Fragment key={key}>{node}</React.Fragment>;
  const out: React.ReactNode[] = [];
  parts.forEach((part, i) => {
    if (typeof part === "string") {
      before = part.replace(/\*\*/g, "");
      part.split("**").forEach((piece, j) => {
        if (j > 0) bold = !bold;
        if (piece) out.push(wrap(`${i}-${j}`, piece));
      });
      return;
    }
    const name = label(part, before);
    const button = (text: string, modifier: number, suffix: string, key: string) => {
      const roll = { ...part.roll, modifier };
      const title = name + suffix;
      return (
        <Text
          key={key}
          as="button"
          onClick={() => roller.roll(title, roll)}
          title={`掷 ${rollExpression(roll)}：${title}`}
          sx={rollButton}
        >
          {text}
        </Text>
      );
    };
    if (part.map) {
      // PF2: first, second and third attack (multiple attack penalty)
      const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);
      const m = part.roll.modifier;
      out.push(
        wrap(
          `${i}`,
          <>
            {button(part.text, m, "", `${i}a`)}
            {" / "}
            {button(signed(m - part.map), m - part.map, "（第二击）", `${i}b`)}
            {" / "}
            {button(signed(m - 2 * part.map), m - 2 * part.map, "（第三击）", `${i}c`)}
          </>
        )
      );
    } else {
      out.push(wrap(`${i}`, button(part.text, part.roll.modifier, "", `${i}a`)));
    }
  });
  return <>{out}</>;
}

/** The latest rolls */
export function RollLog({ roller, hint = "点下划线的数值掷骰" }: { roller: DiceRoller; hint?: string }) {
  const { log } = roller;
  return (
    <Box
      sx={{
        position: "sticky",
        top: 0,
        bg: "background",
        zIndex: 1,
        borderBottom: log.length ? "1px solid" : "none",
        borderColor: "border",
        mb: 2,
        py: 1,
      }}
    >
      {log.map(({ id, label, result, boluo }, i) => (
        <Text
          key={id}
          sx={{ display: "block", fontSize: i === 0 ? 1 : 0, opacity: i === 0 ? 1 : 0.6 }}
        >
          🎲 <b>{label}</b>：{describeSummary(result)}
          {boluo && i === 0 && (
            <Text
              as="span"
              sx={{ fontSize: 0, ml: 1, color: boluo.startsWith("未") ? "#c0392b" : "gray" }}
            >
              · {boluo}
            </Text>
          )}
        </Text>
      ))}
      {log.length === 0 && (
        <Text sx={{ fontSize: 0, color: "gray" }}>{hint}</Text>
      )}
    </Box>
  );
}

const rollButton = {
  bg: "transparent",
  border: "none",
  p: 0,
  font: "inherit",
  color: "primary",
  textDecoration: "underline dotted",
  textUnderlineOffset: "3px",
  cursor: "pointer",
};
