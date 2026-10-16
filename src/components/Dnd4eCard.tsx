import { useEffect, useState } from "react";
import { Box, Flex, Link, Text } from "theme-ui";

import { SearchResult, openFiveECard } from "../helpers/fiveETools";
import { findDnd4eTitle, loadDnd4eRecord } from "../helpers/dnd4e";
import { splitRolls } from "../helpers/fiveEDice";
import { DiceRoller, RollLog, RollableText, useDiceRoller } from "./DiceRoller";

type Dnd4eCardProps = { result: SearchResult };

// Power card title colors by usage, as on the wiki
const USAGE_COLOR: Record<string, string> = {
  随意: "#4b7d3b",
  遭遇: "#8a1c26",
  每日: "#3d3d3d",
};

// "label value" lines for kinds whose data is in fields
const FIELD_LINES: [string, string][] = [
  ["tier", "层级"],
  ["prerequisite", "前提"],
  ["item-category", "类别"],
  ["item-suitable", "适用"],
  ["ritual-level", "等级"],
  ["ritual-catagory", "类别"],
  ["key-skill", "关键技能"],
  ["component-category", "材料类别"],
  ["component-type", "材料类型"],
  ["race-abilityone", "属性调整"],
  ["race-abilitytwo", "属性调整"],
  ["race-size", "体型"],
  ["race-speed", "速度"],
  ["race-vision", "视觉"],
  ["role", "职位"],
  ["power source", "威能来源"],
  ["skill", "技能"],
];

/** 4e card for a quick search result */
function Dnd4eCard({ result }: Dnd4eCardProps) {
  const [record, setRecord] = useState<any>(null);
  const [error, setError] = useState("");
  const roller = useDiceRoller();

  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    setError("");
    if (!result.dnd4e) return setError("资料位置未知");
    loadDnd4eRecord(result.dnd4e)
      .then((r) => !cancelled && setRecord(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [result]);

  if (error) {
    return (
      <Box sx={{ p: 3, fontSize: 1 }}>
        <Text>读取资料失败：{error}</Text>
        <WikiLink url={result.url} />
      </Box>
    );
  }
  if (!record) {
    return <Text sx={{ p: 3, fontSize: 1, color: "gray" }}>正在读取资料…</Text>;
  }

  const isPower = result.dnd4e?.kind === "威能" || !!record["power-type"];
  const texts = [record.details, record.benefit, record.special, record.body].filter(Boolean);
  const hasRolls = texts.some((t) => splitRolls(String(t)).some((p) => typeof p !== "string"));

  return (
    <Box sx={{ p: 3, fontSize: 1, lineHeight: 1.6 }}>
      {isPower ? (
        <PowerHeader record={record} />
      ) : (
        <>
          <Text sx={{ fontSize: 3, fontWeight: "bold", display: "block" }}>
            {record.cn}
            {record.en && (
              <Text as="span" sx={{ fontSize: 0, color: "gray", ml: 2 }}>
                {record.en}
              </Text>
            )}
          </Text>
          <Text sx={{ fontSize: 0, color: "gray", display: "block" }}>
            {[result.categoryLabel, record.rarity, record.level, record.source].filter(Boolean).join(" · ")}
          </Text>
          {record.flavorText && (
            <Text sx={{ display: "block", fontStyle: "italic", color: "gray", mt: 1 }}>
              {record.flavorText}
            </Text>
          )}
        </>
      )}
      {hasRolls && <RollLog roller={roller} />}

      {!isPower && FIELD_LINES.some(([f]) => record[f]) && (
        <Box sx={rule}>
          {FIELD_LINES.filter(([f]) => record[f]).map(([f, label]) => (
            <Text key={f} sx={{ display: "block" }}>
              <b>{label}</b> <Dnd4eText text={record[f]} roller={roller} context={record.cn} />
            </Text>
          ))}
        </Box>
      )}
      {record.details && (
        <Box sx={isPower ? { mt: 1 } : rule}>
          <Dnd4eText text={record.details} roller={roller} context={record.cn} />
        </Box>
      )}
      {record.benefit && (
        <Box sx={rule}>
          <Dnd4eText text={`**增益：**${record.benefit}`} roller={roller} context={record.cn} />
        </Box>
      )}
      {record.special && (
        <Box sx={{ mt: 1 }}>
          <Dnd4eText text={`**特殊：**${record.special}`} roller={roller} context={record.cn} />
        </Box>
      )}
      {record.body && (
        <Box sx={rule}>
          <Dnd4eText text={record.body} roller={roller} context={record.cn} />
        </Box>
      )}
      <WikiLink url={result.url} />
    </Box>
  );
}

function PowerHeader({ record }: { record: any }) {
  const color = USAGE_COLOR[record.usage] || "#3d3d3d";
  return (
    <Box>
      <Flex
        sx={{
          bg: color,
          color: "white",
          px: 2,
          py: 1,
          borderRadius: "4px 4px 0 0",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 2,
        }}
      >
        <Text sx={{ fontWeight: "bold", fontSize: 2 }}>
          {record.cn}
          {record.en && (
            <Text as="span" sx={{ fontSize: 0, fontWeight: "normal", ml: 2, opacity: 0.85 }}>
              {record.en}
            </Text>
          )}
        </Text>
        <Text sx={{ fontSize: 0, whiteSpace: "nowrap" }}>
          {[record["power-type"], record.level].filter(Boolean).join(" ")}
        </Text>
      </Flex>
      <Box sx={{ border: "1px solid", borderColor: color, borderTop: "none", borderRadius: "0 0 4px 4px", px: 2, py: 1 }}>
        {record.flavorText && (
          <Text sx={{ display: "block", fontStyle: "italic", color: "gray" }}>{record.flavorText}</Text>
        )}
        <Text sx={{ display: "block", fontWeight: "bold" }}>
          {[record.usage, record.keywords].filter(Boolean).join(" ✦ ")}
        </Text>
        <Text sx={{ display: "block", fontWeight: "bold" }}>
          {[record.actionType, record.range].filter(Boolean).join(" ✦ ")}
        </Text>
        {record.source && (
          <Text sx={{ display: "block", fontSize: 0, color: "gray" }}>
            {record.source}
            {record.magazine ? ` ${record.magazine}` : ""}
            {record.tags?.length ? ` · ${record.tags.join("、")}` : ""}
          </Text>
        )}
      </Box>
    </Box>
  );
}

/** Lines of 4e text: **bold**, dice to roll, ⟦entries⟧ to open */
function Dnd4eText({ text, roller, context }: { text: string; roller: DiceRoller; context: string }) {
  return (
    <>
      {String(text)
        .split("\n")
        .map((line, i) => (
          <Text key={i} sx={{ display: "block", minHeight: line ? undefined : "0.6em" }}>
            {line.split(/(⟦[^⟧]+⟧)/).map((piece, j) => {
              const link = piece.match(/^⟦([^⟧]+)⟧$/);
              if (link) return <EntryLink key={j} title={link[1]} />;
              return (
                <RollableText
                  key={j}
                  parts={splitRolls(piece)}
                  label={(part) => `${context}${part.kind === "damage" ? " 伤害" : ""}`}
                  roller={roller}
                />
              );
            })}
          </Text>
        ))}
    </>
  );
}

/** Another wiki entry mentioned in the text: opens its card */
function EntryLink({ title }: { title: string }) {
  function open() {
    findDnd4eTitle(title)
      .then((result) => result && openFiveECard(result))
      .catch(() => {});
  }
  return (
    <Text as="button" onClick={open} title={`查看「${title}」`} sx={linkButton}>
      {title}
    </Text>
  );
}

function WikiLink({ url }: { url: string }) {
  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      sx={{ display: "block", mt: 3, color: "primary", fontSize: 1 }}
    >
      在 4e Wiki 打开（资料来自 leonspace.site，经站长同意镜像）
    </Link>
  );
}

const rule = { borderTop: "1px solid", borderColor: "border", mt: 2, pt: 2 };
const linkButton = {
  bg: "transparent",
  border: "none",
  p: 0,
  font: "inherit",
  color: "primary",
  textDecoration: "underline",
  cursor: "pointer",
  textAlign: "left" as const,
};

export default Dnd4eCard;
