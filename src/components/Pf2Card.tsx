import React, { useEffect, useState } from "react";
import { Box, Flex, Link, Text } from "theme-ui";

import {
  MONSTER_DRAG_TYPE,
  SearchResult,
  monsterRefOf,
} from "../helpers/fiveETools";
import {
  Pf2Kind,
  loadPf2Creature,
  loadPf2Record,
} from "../helpers/pf2";
import { TextPart, splitChecks, splitPf2Rolls } from "../helpers/fiveEDice";
import { DiceRoller, RollLog, RollableText, useDiceRoller } from "./DiceRoller";

type Pf2CardProps = { result: SearchResult };

const ACTIONS: Record<string, string> = { 1: "◆", 2: "◆◆", 3: "◆◆◆", R: "⟲", F: "◇" };
const actionText = (v: unknown) =>
  v == null ? "" : String(v).split("-").map((p) => ACTIONS[p] || p).join("～");

// Fields shown as "label value" lines, per kind, before the description
const LINES: Partial<Record<Pf2Kind, string[]>> = {
  Spells: ["法术分类", "根源", "施法", "成分", "射程", "区域", "目标", "防御", "持续", "触发", "需求", "开销"],
  Feats: ["专长分类", "动作", "先决条件", "前置专长", "频率", "触发", "需求", "开销"],
  Items: ["物品分类", "用法", "负载", "占手", "启动", "持续", "弹药", "基础物品", "制作需求"],
  Actions: ["动作", "需求", "触发", "频率", "开销"],
  Rituals: ["施放", "开销", "主要检定", "次要检定", "次要施法者", "射程", "区域", "目标", "持续", "需求"],
  Backgrounds: ["属性提升", "技能提升", "技能专长"],
  Traits: ["特征分类"],
};
// Paragraphs after the description
const AFTER = ["升阶", "大成功", "成功", "失败", "大失败", "特殊", "变体", "升级", "相关"];
// Fields holding action counts
const ACTION_FIELDS = new Set(["动作", "施法"]);

/** PF2 card for a quick search result: creature stat block or entry */
function Pf2Card({ result }: Pf2CardProps) {
  const [record, setRecord] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    setError("");
    (result.pf2
      ? loadPf2Record(result.pf2)
      : loadPf2Creature(monsterRefOf(result))
    )
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
  return result.isMonster ? (
    <CreatureCard result={result} record={record} />
  ) : (
    <EntryCard result={result} record={record} />
  );
}

/* ---------- shared bits ---------- */

function WikiLink({ url }: { url: string }) {
  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      sx={{ display: "block", mt: 3, color: "primary", fontSize: 1 }}
    >
      在 PF2 中文维基打开（资料来自该维基，CC BY-SA）
    </Link>
  );
}

function Traits({ record }: { record: any }) {
  const traits = [
    record.稀有度 && record.稀有度 !== "常见" ? record.稀有度 : "",
    record.体型 || "",
    ...String(record.特征 || "").split(/[,，]/),
  ]
    .map((t) => t.trim())
    .filter(Boolean);
  if (!traits.length) return null;
  return (
    <Flex sx={{ flexWrap: "wrap", gap: "4px", my: 1 }}>
      {traits.map((t) => (
        <Text
          key={t}
          sx={{
            fontSize: 0,
            px: 1,
            borderRadius: "3px",
            bg: "muted",
            whiteSpace: "nowrap",
          }}
        >
          {t}
        </Text>
      ))}
    </Flex>
  );
}

/** Multi-line PF2 text with its rolls; label names strikes and damage */
function Pf2Text({
  text,
  roller,
  context,
}: {
  text: string;
  roller: DiceRoller;
  context: string;
}) {
  return (
    <>
      {String(text)
        .split("\n")
        .map((line, i) => {
          // The weapon whose damage follows its strike
          let weapon = "";
          const label = (part: Exclude<TextPart, string>, before: string) => {
            if (part.kind === "hit") {
              weapon = before.split(/[\s◆◇⟲，,；;：:]/).filter(Boolean).pop() || context;
              return `${weapon} 攻击`;
            }
            return part.kind === "damage" ? `${weapon || context} 伤害` : context;
          };
          return (
            <Text key={i} sx={{ display: "block", minHeight: line ? undefined : "0.6em" }}>
              <RollableText parts={splitPf2Rolls(line)} label={label} roller={roller} />
            </Text>
          );
        })}
    </>
  );
}

const rule = { borderTop: "1px solid", borderColor: "border", my: 2 };
const signed = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) ? (v < 0 ? `${v}` : `+${v}`) : String(n ?? "");
};

/* ---------- creatures ---------- */

const ABILITIES: [string, string][] = [
  ["Strength", "力量"],
  ["Dexterity", "敏捷"],
  ["Constitution", "体质"],
  ["Intelligence", "智力"],
  ["Wisdom", "感知"],
  ["Charisma", "魅力"],
];
const SAVES: [string, string][] = [
  ["Fortitude", "强韧"],
  ["Reflex", "反射"],
  ["Will", "意志"],
];

function CreatureCard({ result, record }: { result: SearchResult; record: any }) {
  const image = record.image ? `/pf2img/${record.image}` : null;
  const roller = useDiceRoller(result.name);

  function handleDragStart(event: React.DragEvent) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(MONSTER_DRAG_TYPE, JSON.stringify(monsterRefOf(result)));
    event.dataTransfer.setData("text/plain", result.name);
  }

  const check = (label: string, value: unknown) => (
    <RollableText parts={splitChecks(signed(value))} label={() => label} roller={roller} />
  );
  const line = (label: string, content: React.ReactNode) =>
    content ? (
      <Text sx={{ display: "block" }}>
        <b>{label}</b> {content}
      </Text>
    ) : null;

  return (
    <Box sx={{ p: 3, fontSize: 1, lineHeight: 1.5 }}>
      <Flex
        draggable
        onDragStart={handleDragStart}
        title="拖到地图变成棋子，或拖进小队状态面板"
        sx={{ alignItems: "center", cursor: "grab", mb: 1 }}
      >
        {image && (
          <img
            src={image}
            alt=""
            draggable={false}
            style={{ width: 56, height: 56, objectFit: "cover", objectPosition: "50% 15%", borderRadius: "50%", marginRight: 10, flexShrink: 0 }}
          />
        )}
        <Box sx={{ flexGrow: 1 }}>
          <Text sx={{ fontSize: 3, fontWeight: "bold", display: "block" }}>
            {record.中文}
            {record.原文 && (
              <Text as="span" sx={{ fontSize: 0, color: "gray", ml: 2 }}>
                {record.原文}
              </Text>
            )}
          </Text>
          <Text sx={{ fontSize: 0, color: "gray", display: "block" }}>
            生物 {record.等级}
            {record.生物子类 ? ` · ${record.生物子类}` : ""} · {record.来源}
          </Text>
        </Box>
        <Text sx={{ fontSize: 0, color: "primary", whiteSpace: "nowrap" }}>⠿ 拖动</Text>
      </Flex>
      <Traits record={record} />
      <RollLog roller={roller} />

      {line(
        "察觉",
        <>
          {check("察觉（先攻）", record.察觉)}
          {record.感官 ? `；${record.感官}` : ""}
        </>
      )}
      {line("语言", record.语言)}
      {record.技能 &&
        line(
          "技能",
          <RollableText
            parts={splitChecks(record.技能)}
            label={(_, before) => `${before.split(/[，,、；;]/).pop()!.trim()}检定`}
            roller={roller}
          />
        )}
      <Flex sx={{ flexWrap: "wrap", gap: "2px 10px" }}>
        {ABILITIES.map(([key, label]) => (
          <Text key={key}>
            <b>{label}</b> {check(`${label}检定`, record[key])}
          </Text>
        ))}
      </Flex>
      {record.被动能力 && <Pf2Text text={record.被动能力} roller={roller} context={record.中文} />}

      <Box sx={rule} />
      <Text sx={{ display: "block" }}>
        <b>AC</b> {record.AC}；
        {SAVES.map(([key, label], i) => (
          <React.Fragment key={key}>
            {i > 0 && "，"}
            <b>{label}</b> {check(`${label}豁免`, record[key])}
          </React.Fragment>
        ))}
        {record.豁免附加 ? `；${record.豁免附加}` : ""}
      </Text>
      <Text sx={{ display: "block" }}>
        <b>HP</b> {record.HP}
        {record.Immunity ? `；免疫 ${record.Immunity}` : ""}
        {record.Resistance ? `；抗性 ${record.Resistance}` : ""}
        {record.Weakness ? `；弱点 ${record.Weakness}` : ""}
      </Text>
      {record.防御能力 && <Pf2Text text={record.防御能力} roller={roller} context={record.中文} />}

      <Box sx={rule} />
      {line("速度", record.速度)}
      {record.攻击能力 && <Pf2Text text={record.攻击能力} roller={roller} context={record.中文} />}
      {record.Spell_DC && line("法术 DC", record.Spell_DC)}

      {record.描述 && (
        <Text sx={{ display: "block", mt: 2, fontSize: 0, color: "gray" }}>{record.描述}</Text>
      )}
      <WikiLink url={result.url} />
    </Box>
  );
}

/* ---------- everything else ---------- */

function EntryCard({ result, record }: { result: SearchResult; record: any }) {
  const roller = useDiceRoller();
  const kind = result.pf2?.kind;
  const lines = (kind && LINES[kind]) || [];
  const level = record.等级 ?? record.环级;
  const text = (field: string) =>
    ACTION_FIELDS.has(field) && /^[123RF](-[123RF])?$/.test(String(record[field]))
      ? actionText(record[field])
      : String(record[field]);
  const hasRolls = [record.描述, ...AFTER.map((f) => record[f])]
    .filter(Boolean)
    .some((t) => splitPf2Rolls(String(t)).some((p) => typeof p !== "string"));

  return (
    <Box sx={{ p: 3, fontSize: 1, lineHeight: 1.6 }}>
      <Text sx={{ fontSize: 3, fontWeight: "bold", display: "block" }}>
        {record.中文}
        {record.动作 != null && (
          <Text as="span" sx={{ ml: 2 }}>
            {actionText(record.动作)}
          </Text>
        )}
        {record.原文 && (
          <Text as="span" sx={{ fontSize: 0, color: "gray", ml: 2 }}>
            {record.原文}
          </Text>
        )}
      </Text>
      <Text sx={{ fontSize: 0, color: "gray", display: "block" }}>
        {result.categoryLabel.split(" ")[0]}
        {level != null ? ` ${level}` : ""} · {record.来源}
      </Text>
      <Traits record={{ ...record, 体型: undefined }} />
      {hasRolls && <RollLog roller={roller} />}
      {lines.some((f) => record[f] != null) && (
        <Box sx={rule}>
          {lines
            .filter((f) => record[f] != null)
            .map((f) => (
              <Text key={f} sx={{ display: "block" }}>
                <b>{f}</b> {text(f)}
              </Text>
            ))}
        </Box>
      )}
      {Array.isArray(record.类型数据) && record.类型数据.length > 0 && (
        <Box sx={rule}>
          {record.类型数据.map((t: any, i: number) => (
            <Text key={i} sx={{ display: "block" }}>
              <b>{t.类型 || record.中文}</b>
              {t.等级 != null ? ` 等级 ${t.等级}` : ""}
              {t.价格 ? `，${t.价格}` : ""}
              {t.类型描述 ? `：${t.类型描述}` : ""}
            </Text>
          ))}
        </Box>
      )}
      <Box sx={rule}>
        {record.描述 && <Pf2Text text={record.描述} roller={roller} context={record.中文} />}
        {AFTER.filter((f) => record[f]).map((f) => (
          <Box key={f} sx={{ mt: 1 }}>
            <Pf2Text
              text={/^\*\*/.test(String(record[f])) ? String(record[f]) : `**${f}** ${record[f]}`}
              roller={roller}
              context={record.中文}
            />
          </Box>
        ))}
      </Box>
      <WikiLink url={result.url} />
    </Box>
  );
}

export default Pf2Card;
