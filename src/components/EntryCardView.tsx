import { useEffect, useState } from "react";
import { Box, Text } from "theme-ui";

import { SearchResult } from "../helpers/fiveETools";
import { EntryCard, loadEntryCard } from "../helpers/fiveEEntries";
import { TextPart, splitRolls } from "../helpers/fiveEDice";
import { RollLog, RollableText, useDiceRoller } from "./DiceRoller";

type EntryCardViewProps = {
  result: SearchResult;
  onOpenFullPage: () => void;
};

/** Spell / item / condition / ... card for the quick search (just the entry) */
function EntryCardView({ result, onOpenFullPage }: EntryCardViewProps) {
  const [card, setCard] = useState<EntryCard | null>(null);
  const [error, setError] = useState("");
  // Spell damage and the like: rolled as the user (no speaker)
  const roller = useDiceRoller();

  useEffect(() => {
    let cancelled = false;
    setCard(null);
    setError("");
    loadEntryCard(result)
      .then((found) => {
        if (cancelled) return;
        // Not in the data files we read: show the 5etools page instead
        if (found) setCard(found);
        else onOpenFullPage();
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // onOpenFullPage changes every render; the result decides what to load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  if (error) {
    return (
      <Box sx={{ p: 3, fontSize: 1 }}>
        <Text>读取资料失败：{error}</Text>
        <Text as="button" onClick={onOpenFullPage} sx={linkButton}>
          在 5etools 打开完整页面
        </Text>
      </Box>
    );
  }
  if (!card) {
    return <Text sx={{ p: 3, fontSize: 1, color: "gray" }}>正在读取资料…</Text>;
  }
  const rollLabel = (part: Exclude<TextPart, string>) =>
    `${card.name}${part.kind === "damage" ? " 伤害" : part.kind === "hit" ? " 命中" : ""}`;
  const hasRolls = [...card.lines.map((l) => l.text), ...card.paragraphs].some(
    (text) => splitRolls(text).some((part) => typeof part !== "string")
  );
  return (
    <Box sx={{ p: 3, fontSize: 1, lineHeight: 1.6 }}>
      <Text sx={{ fontSize: 3, fontWeight: "bold", display: "block" }}>
        {card.name}
        {card.englishName && (
          <Text as="span" sx={{ fontSize: 0, color: "gray", ml: 2 }}>
            {card.englishName}
          </Text>
        )}
      </Text>
      <Text sx={{ fontSize: 0, color: "gray", display: "block" }}>
        {card.subtitle} · {result.source}
      </Text>
      {hasRolls && <RollLog roller={roller} />}
      {card.lines.length > 0 && (
        <Box sx={{ borderTop: "1px solid", borderColor: "border", mt: 2, pt: 2 }}>
          {card.lines.map((line) => (
            <Text key={line.label} sx={{ display: "block" }}>
              <b>{line.label}</b>{" "}
              <RollableText parts={splitRolls(line.text)} label={rollLabel} roller={roller} />
            </Text>
          ))}
        </Box>
      )}
      <Box sx={{ borderTop: "1px solid", borderColor: "border", mt: 2, pt: 2 }}>
        {card.paragraphs.map((p, i) => (
          <Text key={i} sx={{ display: "block", mb: 1 }}>
            <RollableText parts={splitRolls(p)} label={rollLabel} roller={roller} />
          </Text>
        ))}
      </Box>
      <Text as="button" onClick={onOpenFullPage} sx={linkButton}>
        在 5etools 打开完整页面
      </Text>
    </Box>
  );
}

const linkButton = {
  display: "block",
  mt: 3,
  bg: "transparent",
  border: "none",
  p: 0,
  color: "primary",
  cursor: "pointer",
  fontSize: 1,
};

export default EntryCardView;
