import React, { useEffect, useState } from "react";
import { Box, Flex, Link, Text } from "theme-ui";

import {
  MONSTER_DRAG_TYPE,
  SearchResult,
  monsterRefOf,
  openFiveECard,
} from "../helpers/fiveETools";
import {
  Dnd3rRecord,
  findDnd3rTitle,
  isDnd3rChm,
  loadDnd3rMonsterRecord,
  loadDnd3rRecord,
} from "../helpers/dnd3r";
import { TextPart, splitChecks, splitDnd3rAttacks, splitRolls } from "../helpers/fiveEDice";
import { DiceRoller, RollLog, RollableText, useDiceRoller } from "./DiceRoller";
import { FieldGrid, Tile, chipBox, sectionTitle, tileNote, tileValue } from "./StatBlock";

type Dnd3rCardProps = { result: SearchResult };

// Monster fields whose bonuses are d20 checks, and attack lines
const CHECK_FIELDS = new Set(["先攻", "豁免", "基本攻击/擒抱", "技能"]);
const ATTACK_FIELDS = new Set(["攻击", "全力攻击"]);

/** 3R card for a quick search result: fields, then the text */
function Dnd3rCard({ result }: Dnd3rCardProps) {
  const [record, setRecord] = useState<Dnd3rRecord | null>(null);
  const [error, setError] = useState("");
  const isMonster = result.dnd3r?.kind === "怪物" || result.isMonster;
  // A monster's rolls name it (in Boluo / Discord)
  const roller = useDiceRoller(isMonster ? record?.name || result.name : undefined);

  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    setError("");
    // A stored monster (token menu, party panel) is found by name and page
    const load = result.dnd3r
      ? loadDnd3rRecord(result.dnd3r)
      : result.isMonster
        ? loadDnd3rMonsterRecord(monsterRefOf(result))
        : Promise.reject(new Error("资料位置未知"));
    load
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
        <WikiLink result={result} />
      </Box>
    );
  }
  if (!record) {
    return <Text sx={{ p: 3, fontSize: 1, color: "gray" }}>正在读取资料…</Text>;
  }

  function handleDragStart(event: React.DragEvent) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(MONSTER_DRAG_TYPE, JSON.stringify(monsterRefOf(result)));
    event.dataTransfer.setData("text/plain", result.name);
  }

  const kind = result.dnd3r?.kind || "";
  const get = (name: string) => record.fields?.find(([k]) => k === name)?.[1] || "";
  const subtitle = isMonster
    ? [
        [get("体型"), get("类型")].filter(Boolean).join(" ") +
          (get("亚种") ? `（${get("亚种")}）` : ""),
        get("挑战等级") && `CR ${get("挑战等级")}`,
        record.source,
      ]
        .filter(Boolean)
        .join(" · ")
    : [kind, record.source, ...(record.tags || [])].filter(Boolean).join(" · ");
  const texts = [...(record.fields || []), ...(record.body || [])].map(([, t]) => t);
  const hasRolls = isMonster || texts.some((t) => splitRolls(t).some((p) => typeof p !== "string"));
  const rowProps = (label: string) => ({
    roller,
    context: isMonster ? label : record.name,
    split: ATTACK_FIELDS.has(label)
      ? splitDnd3rAttacks
      : CHECK_FIELDS.has(label)
        ? splitChecks
        : splitRolls,
  });

  return (
    <Box sx={{ p: 3, fontSize: 1, lineHeight: 1.6 }}>
      <Flex
        draggable={isMonster}
        onDragStart={isMonster ? handleDragStart : undefined}
        title={isMonster ? "拖到地图变成棋子，或拖进小队状态面板" : undefined}
        sx={{ alignItems: "center", cursor: isMonster ? "grab" : "default" }}
      >
        <Box sx={{ flexGrow: 1 }}>
          <Text sx={{ fontSize: 3, fontWeight: "bold", display: "block" }}>
            {record.name}
            {record.en && (
              <Text as="span" sx={{ fontSize: 0, color: "gray", ml: 2 }}>
                {record.en}
              </Text>
            )}
          </Text>
          <Text sx={{ fontSize: 0, color: "gray", display: "block" }}>{subtitle}</Text>
        </Box>
        {isMonster && (
          <Text sx={{ fontSize: 0, color: "primary", whiteSpace: "nowrap" }}>⠿ 拖动</Text>
        )}
      </Flex>
      {record.summary && (
        <Text sx={{ display: "block", fontStyle: "italic", color: "gray", mt: 1 }}>
          <Dnd3rText text={record.summary} roller={roller} context={record.name} />
        </Text>
      )}
      {hasRolls && <RollLog roller={roller} />}

      {isMonster ? (
        <MonsterBlock record={record} roller={roller} rowProps={rowProps} />
      ) : (
        record.fields && (
          <Box sx={rule}>
            <FieldTable rows={record.fields} rowProps={rowProps} />
          </Box>
        )
      )}
      {record.body?.map(([label, text], i) => (
        <Box key={i} sx={rule}>
          {label && <Text sx={{ display: "block", fontWeight: "bold" }}>{label}</Text>}
          <Dnd3rText text={text} roller={roller} context={record.name} />
        </Box>
      ))}
      <WikiLink result={result} />
    </Box>
  );
}

type RowProps = (label: string) => {
  roller: DiceRoller;
  context: string;
  split: (text: string) => TextPart[];
};

/** Fields as a two-column table, each value with its rolls and links */
function FieldTable({
  rows,
  rowProps,
  dim = false,
}: {
  rows: [string, string][];
  rowProps: RowProps;
  dim?: boolean;
}) {
  return (
    <FieldGrid
      dim={dim}
      rows={rows.map(([label, text]) => [label, <Dnd3rText text={text} {...rowProps(label)} />])}
    />
  );
}

// A monster's fields, grouped; the rest of its fields go under 其他
const MONSTER_SECTIONS: [string, string[], boolean?][] = [
  ["战斗", ["基本攻击/擒抱", "攻击", "全力攻击", "占据/触及", "特殊攻击"]],
  ["能力", ["特殊特性", "技能", "专长"]],
  ["生态", ["环境", "组织", "阵营", "宝物", "进化", "等级调整"], true],
];
// Shown in the header, the stat tiles, the saves and the ability grid
const MONSTER_SHOWN = new Set([
  "体型",
  "类型",
  "亚种",
  "挑战等级",
  "防御等级",
  "生命骰",
  "先攻",
  "速度",
  "豁免",
  "属性",
]);
const ABILITIES = ["力量", "敏捷", "体质", "智力", "感知", "魅力"];

/** A 3R monster: stat tiles, saves, abilities, then its fields by section */
function MonsterBlock({
  record,
  roller,
  rowProps,
}: {
  record: Dnd3rRecord;
  roller: DiceRoller;
  rowProps: RowProps;
}) {
  const fields = record.fields || [];
  const get = (name: string) => fields.find(([k]) => k === name)?.[1] || "";
  const armor = get("防御等级");
  const touch = armor.match(/接触\s*(\d+)/)?.[1];
  const flat = armor.match(/措手不及\s*(\d+)/)?.[1];
  const hitDice = get("生命骰").replace(/\s*[（(][^）)]*(?:hp|生命)[^）)]*[）)]\s*/i, "");
  const saves = Array.from(get("豁免").matchAll(/(强韧|反射|意志)\s*\|?\s*([+\-−]\d+)/g));
  const abilityText = get("属性");
  const scores = ABILITIES.map((name) => {
    const m = abilityText.match(new RegExp(`${name}\\s*(\\d+|—|-)`));
    return { name, score: m && /\d/.test(m[1]) ? Number(m[1]) : null };
  });
  const used = new Set([
    ...Array.from(MONSTER_SHOWN),
    ...MONSTER_SECTIONS.flatMap(([, names]) => names),
  ]);
  const others = fields.filter(([k]) => !used.has(k));
  const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);

  return (
    <>
      {/* AC, HP, initiative, speed */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 1,
          mt: 2,
        }}
      >
        <Tile label="防御等级" title={armor}>
          <Text sx={tileValue}>{record.stats?.ac ?? "—"}</Text>
          <Text sx={tileNote}>
            {[touch && `接触 ${touch}`, flat && `措手不及 ${flat}`].filter(Boolean).join(" · ")}
          </Text>
        </Tile>
        <Tile label="生命值" title={get("生命骰")}>
          <Text sx={tileValue}>{record.stats?.hp ?? "—"}</Text>
          <Text sx={tileNote}>
            <Dnd3rText text={hitDice} roller={roller} context="生命值" />
          </Text>
        </Tile>
        <Tile label="先攻">
          <Text sx={tileValue}>
            <Dnd3rText
              text={get("先攻") || "+0"}
              roller={roller}
              context="先攻"
              split={splitChecks}
            />
          </Text>
        </Tile>
        <Tile label="速度" title={get("速度")}>
          {/* The first speed; the rest (armor, fly…) on hover */}
          <Text sx={{ ...tileValue, fontSize: 2 }}>
            {get("速度")
              .split(/[；;，,(（]/)[0]
              .replace(/\s+/g, "") || "—"}
          </Text>
          <Text sx={tileNote}>{get("速度").split(/[；;]/).slice(1).join("；").trim()}</Text>
        </Tile>
      </Box>

      {/* Saves */}
      {saves.length > 0 && (
        <Flex sx={{ gap: 1, mt: 2, alignItems: "center", flexWrap: "wrap" }}>
          <Text sx={{ fontSize: 0, color: "gray", fontWeight: "bold", mr: 1 }}>豁免</Text>
          {saves.map(([, name, bonus]) => (
            <Box key={name} sx={chipBox}>
              {name}{" "}
              <Dnd3rText text={bonus} roller={roller} context={`${name}豁免`} split={splitChecks} />
            </Box>
          ))}
        </Flex>
      )}

      {/* Ability scores */}
      {abilityText && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 1,
            mt: 2,
            textAlign: "center",
          }}
        >
          {scores.map(({ name, score }) => {
            const mod = score === null ? null : Math.floor((score - 10) / 2);
            return (
              <Box
                key={name}
                sx={{
                  border: "1px solid",
                  borderColor: "border",
                  borderRadius: "4px",
                  py: 1,
                }}
              >
                <Text sx={{ display: "block", fontSize: 0, color: "gray" }}>{name}</Text>
                <Text sx={{ display: "block", fontWeight: "bold" }}>{score ?? "—"}</Text>
                {mod !== null && (
                  <Text sx={{ display: "block", fontSize: 0 }}>
                    <Dnd3rText
                      text={signed(mod)}
                      roller={roller}
                      context={name}
                      split={splitChecks}
                    />
                  </Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {MONSTER_SECTIONS.map(([title, names, dim]) => {
        const rows = names
          .map((n) => [n, get(n)] as [string, string])
          .filter(([, t]) => t && t !== "—");
        if (!rows.length) return null;
        return (
          <Box key={title} sx={rule}>
            <Text sx={sectionTitle}>{title}</Text>
            <FieldTable rows={rows} rowProps={rowProps} dim={dim} />
          </Box>
        );
      })}
      {others.length > 0 && (
        <Box sx={rule}>
          <Text sx={sectionTitle}>其他</Text>
          <FieldTable rows={others} rowProps={rowProps} dim />
        </Box>
      )}
    </>
  );
}

/** Lines of 3R text: **bold**, rolls, ⟦entries⟧ to open */
function Dnd3rText({
  text,
  roller,
  context,
  split = splitRolls,
}: {
  text: string;
  roller: DiceRoller;
  context: string;
  split?: (text: string) => TextPart[];
}) {
  // A roll's name: the words just before it ("长剑" +2 → "长剑 命中", "强韧" +3)
  const label = (part: Exclude<TextPart, string>, before: string) => {
    const words = before
      .replace(/[⟦⟧*]/g, "")
      .split(/[，,；;、（(）)]|或/)
      .pop()!
      .replace(/[\s/:：]+$/g, "")
      .trim();
    const name = words || context;
    return part.kind === "hit" ? `${name} 命中` : part.kind === "damage" ? `${name} 伤害` : name;
  };
  return (
    <>
      {String(text)
        .split("\n")
        .map((line, i, lines) => (
          // One line (a field's value) stays beside its label
          <Text
            key={i}
            sx={{
              display: lines.length > 1 ? "block" : "inline",
              minHeight: line ? undefined : "0.6em",
            }}
          >
            {line.split(/(⟦[^⟧]+⟧)/).map((piece, j) => {
              const link = piece.match(/^⟦([^⟧|]+)(?:\|([^⟧]+))?⟧$/);
              // The entry's own name in its text is not a link to itself
              if (link && (link[2] || link[1]) === context) return link[1];
              if (link) return <EntryLink key={j} text={link[1]} title={link[2] || link[1]} />;
              return <RollableText key={j} parts={split(piece)} label={label} roller={roller} />;
            })}
          </Text>
        ))}
    </>
  );
}

/** Another wiki entry mentioned in the text: opens its card */
function EntryLink({ text, title }: { text: string; title: string }) {
  function open() {
    findDnd3rTitle(title)
      .then((result) => result && openFiveECard(result))
      .catch(() => {});
  }
  return (
    <Text as="button" onClick={open} title={`查看「${title}」`} sx={linkButton}>
      {text}
    </Text>
  );
}

function WikiLink({ result }: { result: SearchResult }) {
  // Entries the wiki lacks are from the CHM: their link is a wiki search
  const chm = isDnd3rChm(result);
  return (
    <Box sx={{ mt: 3, fontSize: 0, color: "gray" }}>
      <Link
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        sx={{ color: "primary", fontSize: 1 }}
      >
        {chm ? "在 3R 中文维基搜索" : "在 3R 中文维基打开"}
      </Link>
      <Text sx={{ display: "block" }}>
        {chm ? "资料来自《3R扩展大不全》" : "资料来自龙与地下城三版中文维基（CC BY-SA）"}
      </Text>
    </Box>
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

export default Dnd3rCard;
