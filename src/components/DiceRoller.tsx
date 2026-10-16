import { useState } from "react";
import { Box, Flex, Label, Checkbox, Text } from "theme-ui";

import {
  Roll,
  RollResult,
  TextPart,
  describeRoll,
  rollDice,
  rollExpression,
} from "../helpers/fiveEDice";
import {
  Speaker,
  rollsToDiscord,
  sendToDiscord,
  setRollsToDiscord,
} from "../helpers/discordBridge";

type LoggedRoll = { id: number; label: string; result: RollResult };

let nextRollId = 1;

/** Rolls from a 5e card: a short log, optionally sent to Discord */
export function useDiceRoller(speaker?: Speaker) {
  const [log, setLog] = useState<LoggedRoll[]>([]);
  const [toDiscord, setToDiscordState] = useState(rollsToDiscord);
  const [discordError, setDiscordError] = useState("");

  function setToDiscord(value: boolean) {
    setToDiscordState(value);
    setDiscordError("");
    setRollsToDiscord(value);
  }

  function roll(label: string, dice: Roll) {
    const result = rollDice(dice);
    setLog((prev) => [{ id: nextRollId++, label, result }, ...prev].slice(0, 4));
    if (toDiscord) {
      setDiscordError("");
      sendToDiscord(`🎲 **${label}**：${describeRoll(result)}`, speaker).catch(
        (e) => setDiscordError(e instanceof Error ? e.message : String(e))
      );
    }
  }

  return { log, roll, toDiscord, setToDiscord, discordError };
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
  return (
    <>
      {parts.map((part, i) => {
        if (typeof part === "string") {
          before = part;
          return part;
        }
        const name = label(part, before);
        return (
          <Text
            key={i}
            as="button"
            onClick={() => roller.roll(name, part.roll)}
            title={`掷 ${rollExpression(part.roll)}：${name}`}
            sx={rollButton}
          >
            {part.text}
          </Text>
        );
      })}
    </>
  );
}

/** The latest rolls and the "send to Discord" switch */
export function RollLog({ roller }: { roller: DiceRoller }) {
  const { log, toDiscord, setToDiscord, discordError } = roller;
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
      <Flex sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Text sx={{ fontSize: 0, color: "gray" }}>
          {log.length ? "" : "点下划线的数值掷骰"}
        </Text>
        <Label sx={{ width: "auto", alignItems: "center", fontSize: 0, cursor: "pointer" }}>
          <Checkbox
            checked={toDiscord}
            onChange={(e) => setToDiscord(e.target.checked)}
            sx={{ width: 16, height: 16, mr: 1 }}
          />
          掷骰结果发到 Discord
        </Label>
      </Flex>
      {discordError && (
        <Text sx={{ display: "block", fontSize: 0, color: "red" }}>
          没能发到 Discord：{discordError}
        </Text>
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
