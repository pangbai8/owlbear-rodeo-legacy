import React, { useState } from "react";
import { Box, Text } from "theme-ui";

import {
  Roll,
  RollResult,
  TextPart,
  describeRoll,
  rollDice,
  rollExpression,
} from "../helpers/fiveEDice";

type LoggedRoll = { id: number; label: string; result: RollResult };

let nextRollId = 1;

/** Rolls from a 5e or PF2 card, kept as a short log on the card */
export function useDiceRoller() {
  const [log, setLog] = useState<LoggedRoll[]>([]);

  function roll(label: string, dice: Roll) {
    const result = rollDice(dice);
    setLog((prev) => [{ id: nextRollId++, label, result }, ...prev].slice(0, 4));
  }

  return { log, roll };
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
export function RollLog({ roller }: { roller: DiceRoller }) {
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
      {log.map(({ id, label, result }, i) => (
        <Text
          key={id}
          sx={{ display: "block", fontSize: i === 0 ? 1 : 0, opacity: i === 0 ? 1 : 0.6 }}
        >
          🎲 <b>{label}</b>：{describeRoll(result)}
        </Text>
      ))}
      {log.length === 0 && (
        <Text sx={{ fontSize: 0, color: "gray" }}>点下划线的数值掷骰</Text>
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
