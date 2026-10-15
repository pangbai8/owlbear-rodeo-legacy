import React, { useEffect, useState } from "react";
import { Box, Flex, Text } from "theme-ui";

import {
  MONSTER_DRAG_TYPE,
  MonsterRef,
  loadMonster,
  loadMonsterRecord,
} from "../helpers/fiveETools";
import { Statblock, statblock } from "../helpers/fiveEStatblock";

type MonsterCardProps = {
  monster: MonsterRef;
  onOpenFullPage: () => void;
};

/** Compact stat card for the quick search; drag it like a result row */
function MonsterCard({ monster, onOpenFullPage }: MonsterCardProps) {
  const [card, setCard] = useState<Statblock | null>(null);
  const [tokenUrl, setTokenUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setCard(null);
    setError("");
    Promise.all([loadMonsterRecord(monster), loadMonster(monster)])
      .then(([record, stats]) => {
        if (cancelled) return;
        setCard(statblock(record, stats.initBonus));
        setTokenUrl(stats.tokenUrl);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [monster]);

  function handleDragStart(event: React.DragEvent) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(MONSTER_DRAG_TYPE, JSON.stringify(monster));
    event.dataTransfer.setData("text/plain", monster.name);
  }

  if (error) {
    return (
      <Box sx={{ p: 3, fontSize: 1 }}>
        <Text>读取怪物数据失败：{error}</Text>
        <Text as="button" onClick={onOpenFullPage} sx={linkButton}>
          在 5etools 打开完整页面
        </Text>
      </Box>
    );
  }
  if (!card) {
    return <Text sx={{ p: 3, fontSize: 1, color: "gray" }}>正在读取怪物数据…</Text>;
  }

  return (
    <Box sx={{ p: 3, fontSize: 1, lineHeight: 1.5 }}>
      <Flex
        draggable
        onDragStart={handleDragStart}
        title="拖到地图变成棋子，或拖进小队状态面板"
        sx={{ alignItems: "center", cursor: "grab", mb: 2 }}
      >
        {tokenUrl && (
          <img
            src={tokenUrl}
            alt=""
            draggable={false}
            style={{ width: 56, height: 56, marginRight: 10, flexShrink: 0 }}
          />
        )}
        <Box sx={{ flexGrow: 1 }}>
          <Text sx={{ fontSize: 3, fontWeight: "bold", display: "block" }}>
            {card.name}
            {card.englishName && (
              <Text as="span" sx={{ fontSize: 0, color: "gray", ml: 2 }}>
                {card.englishName}
              </Text>
            )}
          </Text>
          <Text sx={{ fontSize: 0, color: "gray", display: "block" }}>
            {card.subtitle}
          </Text>
        </Box>
        <Text sx={{ fontSize: 0, color: "primary", whiteSpace: "nowrap" }}>⠿ 拖动</Text>
      </Flex>

      <Box sx={rule} />
      <Text sx={{ display: "block" }}>
        <b>护甲等级</b> {card.ac}　<b>先攻</b> {card.initiative}
      </Text>
      <Text sx={{ display: "block" }}>
        <b>生命值</b> {card.hp}
      </Text>
      <Text sx={{ display: "block" }}>
        <b>速度</b> {card.speed || "—"}
      </Text>
      <Box sx={rule} />
      <Flex sx={{ justifyContent: "space-between", textAlign: "center", my: 1 }}>
        {card.abilities.map((a) => (
          <Box key={a.key} sx={{ flex: 1 }}>
            <Text sx={{ fontSize: 0, color: "gray", display: "block" }}>{a.label}</Text>
            <Text sx={{ display: "block" }}>
              {a.score} ({a.mod})
            </Text>
          </Box>
        ))}
      </Flex>
      <Box sx={rule} />
      {card.lines.map((line) => (
        <Text key={line.label} sx={{ display: "block" }}>
          <b>{line.label}</b> {line.text}
        </Text>
      ))}
      {card.sections.map((section) => (
        <Box key={section.title} sx={{ mt: 2 }}>
          <Text
            sx={{
              display: "block",
              fontWeight: "bold",
              color: "primary",
              borderBottom: "1px solid",
              borderColor: "border",
              mb: 1,
            }}
          >
            {section.title}
          </Text>
          {section.items.map((item, i) => (
            <Box key={i} sx={{ mb: 1 }}>
              {item.paragraphs.length === 0 ? (
                <Text sx={{ display: "block" }}>
                  <b>{item.name}</b>
                </Text>
              ) : (
                item.paragraphs.map((p, j) => (
                  <Text key={j} sx={{ display: "block" }}>
                    {j === 0 && item.name && <b>{item.name}。</b>}
                    {p}
                  </Text>
                ))
              )}
            </Box>
          ))}
        </Box>
      ))}
      <Text as="button" onClick={onOpenFullPage} sx={linkButton}>
        在 5etools 打开完整页面（含图片与简介）
      </Text>
    </Box>
  );
}

const rule = { borderTop: "1px solid", borderColor: "border", my: 2 };
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

export default MonsterCard;
