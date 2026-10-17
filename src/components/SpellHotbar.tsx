import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { Box, Flex, Input, Text, Textarea } from "theme-ui";

import EntryCardView from "./EntryCardView";
import Pf2Card from "./Pf2Card";
import Dnd4eCard from "./Dnd4eCard";
import { useDiceRoller } from "./DiceRoller";
import { describeSummary, parseFormula } from "../helpers/fiveEDice";
import { SearchResult } from "../helpers/fiveETools";
import { useFloatingWindow } from "../contexts/FloatingWindowContext";
import {
  SLOT_DRAG_TYPE,
  SpellEntry,
  SpellRoll,
  defaultSaves,
  entryFromResult,
  isEntryDrag,
  newId,
  placeInSlot,
  readEntryDrag,
  slotsOf,
  updateGroup,
  useSpellBar,
} from "../helpers/spellBar";
import { RULE_SYSTEM_LABEL, RuleSystem, useRuleSystem } from "../helpers/ruleSystem";

const VISIBLE_KEY = "spellBar.visible";
const SLOT_SIZE = 52;
/** How long the latest rolls stay above the bar */
const ROLLS_SHOWN_MS = 12000;

type Editing = { kind: "slot"; index: number } | { kind: "saves" } | null;

/**
 * The spell bar: an MMORPG-style hotbar at the bottom of the screen. Its
 * slots hold spells and attacks dragged in from the quick search or written
 * by hand; hover one for its description, click it to roll its formulas
 * (to Boluo too, when that switch is on), right-click to edit. Above the
 * slots: the group (a character, say) and its saving throws.
 */
function SpellHotbar() {
  const { isOpen: visible, setIsOpen } = useFloatingWindow("spellBar");
  const [state, update] = useSpellBar();
  const system = useRuleSystem();
  const roller = useDiceRoller();
  const [editing, setEditing] = useState<Editing>(null);
  const [preview, setPreview] = useState<{ index: number; rect: DOMRect } | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rollsShown, setRollsShown] = useState(false);
  const hideTimer = useRef<number>();
  const barRef = useRef<HTMLDivElement>(null);

  // Shown or hidden as last time (the sidebar's star button)
  useEffect(() => {
    try {
      if (localStorage.getItem(VISIBLE_KEY) === "true") setIsOpen(true);
    } catch {}
    // Run once: restore the saved choice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(VISIBLE_KEY, String(visible));
    } catch {}
  }, [visible]);

  // The latest rolls show above the bar for a while
  const latestRoll = roller.log[0];
  useEffect(() => {
    if (!latestRoll) return;
    setRollsShown(true);
    const timer = window.setTimeout(() => setRollsShown(false), ROLLS_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [latestRoll]);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  if (!visible) return null;

  const group = state.groups.find((g) => g.id === state.current) || state.groups[0];
  const groupIndex = state.groups.indexOf(group);
  const slots = slotsOf(group);
  const saves = group.saves || defaultSaves(system);

  function setSlots(change: (slots: (SpellEntry | null)[]) => (SpellEntry | null)[]) {
    update((s) => updateGroup(s, group.id, (g) => ({ ...g, entries: change(slotsOf(g)) })));
  }

  function rollOne(name: string, roll: SpellRoll) {
    const formula = parseFormula(roll.formula);
    if (formula) roller.rollTyped(`${name} ${roll.label}`.trim(), formula);
  }

  function showPreview(index: number, target: HTMLElement) {
    window.clearTimeout(hideTimer.current);
    // Centred on the slot, above the whole bar (its saves stay clickable)
    const slot = target.getBoundingClientRect();
    const bar = barRef.current?.getBoundingClientRect() || slot;
    const rect = new DOMRect(slot.left, bar.top, slot.width, slot.height);
    hideTimer.current = window.setTimeout(() => setPreview({ index, rect }), 250);
  }
  function hidePreview() {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setPreview(null), 200);
  }
  function keepPreview() {
    window.clearTimeout(hideTimer.current);
  }

  async function handleDrop(event: React.DragEvent, index: number) {
    setDropTarget(null);
    const moved = event.dataTransfer.getData(SLOT_DRAG_TYPE);
    if (moved !== "") {
      event.preventDefault();
      const from = Number(moved);
      setSlots((list) => {
        const next = [...list];
        [next[from], next[index]] = [next[index], next[from]];
        return next;
      });
      return;
    }
    const result = readEntryDrag(event.dataTransfer);
    if (!result) return;
    event.preventDefault();
    setLoading(index);
    const entry = await entryFromResult(result);
    setLoading(null);
    setSlots((list) => placeInSlot(list, index, entry));
  }

  function newEntry(index: number) {
    const entry: SpellEntry = {
      id: newId(),
      name: "新条目",
      note: "",
      rolls: [
        { label: "命中", formula: "+5" },
        { label: "伤害", formula: "1d8+3" },
      ],
    };
    setSlots((list) => placeInSlot(list, index, entry));
    setPreview(null);
    setEditing({ kind: "slot", index });
  }

  function switchGroup(step: number) {
    const count = state.groups.length;
    const next = state.groups[(groupIndex + step + count) % count];
    update((s) => ({ ...s, current: next.id }));
    setEditing(null);
  }

  function addGroup() {
    setMenuOpen(false);
    const name = window.prompt("新分组的名字（比如角色名）", "新分组");
    if (!name) return;
    const id = newId();
    update((s) => ({ groups: [...s.groups, { id, name, entries: [] }], current: id }));
  }

  function renameGroup() {
    setMenuOpen(false);
    const name = window.prompt("分组改名", group.name);
    if (!name) return;
    update((s) => updateGroup(s, group.id, (g) => ({ ...g, name })));
  }

  function deleteGroup() {
    setMenuOpen(false);
    if (state.groups.length <= 1) return;
    const count = group.entries.filter(Boolean).length;
    if (!window.confirm(`删除分组「${group.name}」和里面的 ${count} 个条目？`)) return;
    update((s) => {
      const groups = s.groups.filter((g) => g.id !== group.id);
      return { groups, current: groups[0].id };
    });
  }

  const editingEntry = editing?.kind === "slot" ? slots[editing.index] : null;
  const previewEntry = preview && !editing ? slots[preview.index] : null;

  return (
    <Box
      sx={{
        position: "fixed",
        left: "50%",
        bottom: "8px",
        transform: "translateX(-50%)",
        zIndex: 45,
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      {/* The latest rolls */}
      {rollsShown && roller.log.length > 0 && (
        <Box
          sx={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            right: 0,
            mb: 1,
            p: 2,
            bg: "overlay",
            border: "1px solid",
            borderColor: "border",
            borderRadius: "8px",
            fontSize: 1,
          }}
          onClick={() => setRollsShown(false)}
          title="点击收起"
        >
          {roller.log.slice(0, 3).map(({ id, label, result, boluo }, i) => (
            <Text key={id} sx={{ display: "block", opacity: i === 0 ? 1 : 0.6, fontSize: i === 0 ? 1 : 0 }}>
              🎲 <b>{label}</b>：{describeSummary(result)}
              {boluo && i === 0 && (
                <Text as="span" sx={{ fontSize: 0, ml: 1, color: boluo.startsWith("未") ? "#c0392b" : "gray" }}>
                  · {boluo}
                </Text>
              )}
            </Text>
          ))}
        </Box>
      )}

      <Box
        ref={barRef}
        sx={{
          bg: "overlay",
          border: "1px solid",
          borderColor: "border",
          borderRadius: "10px",
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
          p: "6px",
        }}
      >
        {/* Group and saving throws */}
        <Flex sx={{ alignItems: "center", gap: 1, mb: "6px", flexWrap: "wrap", position: "relative" }}>
          <Text as="button" title="上一组" onClick={() => switchGroup(-1)} sx={tool}>
            ‹
          </Text>
          <Text
            as="button"
            onClick={() => setMenuOpen((open) => !open)}
            title="分组：新建、改名、删除"
            sx={{ ...chip, bg: "muted", fontWeight: "bold", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {group.name}
            {state.groups.length > 1 && (
              <Text as="span" sx={{ fontSize: 0, color: "gray", fontWeight: "normal", ml: 1 }}>
                {groupIndex + 1}/{state.groups.length}
              </Text>
            )}
          </Text>
          <Text as="button" title="下一组" onClick={() => switchGroup(1)} sx={tool}>
            ›
          </Text>
          {menuOpen && (
            <Box
              sx={{
                position: "absolute",
                bottom: "100%",
                left: 0,
                mb: 1,
                p: 1,
                bg: "background",
                border: "1px solid",
                borderColor: "border",
                borderRadius: "6px",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
                zIndex: 1,
              }}
            >
              {[
                ["＋ 新建分组", addGroup],
                ["改名", renameGroup],
                ...(state.groups.length > 1 ? [["删除这一组", deleteGroup] as const] : []),
              ].map(([text, action]) => (
                <Text
                  key={text as string}
                  as="button"
                  onClick={action as () => void}
                  sx={{ ...chip, display: "block", width: "100%", textAlign: "left", bg: "transparent", "&:hover": { bg: "highlight" } }}
                >
                  {text as string}
                </Text>
              ))}
            </Box>
          )}
          <Box sx={{ width: "1px", alignSelf: "stretch", bg: "border", mx: 1 }} />
          <Text sx={{ fontSize: 0, color: "gray" }}>豁免</Text>
          {saves.map((save, i) => {
            const ok = !!parseFormula(save.formula);
            return (
              <Text
                key={i}
                as="button"
                onClick={() => ok && rollOne(`${save.label}`, { label: "豁免", formula: save.formula })}
                title={ok ? `掷 ${save.label} 豁免：${save.formula}` : "公式写不对，点 ✎ 修改"}
                sx={{
                  ...chip,
                  px: "6px",
                  fontSize: 0,
                  bg: "muted",
                  opacity: ok ? 1 : 0.5,
                  "&:hover": ok ? { bg: "primary", color: "background" } : {},
                }}
              >
                {save.label} <b>{save.formula}</b>
              </Text>
            );
          })}
          <Text as="button" title="编辑豁免" onClick={() => setEditing({ kind: "saves" })} sx={tool}>
            ✎
          </Text>
        </Flex>

        {/* Slots */}
        <Flex sx={{ gap: "4px" }}>
          {slots.map((entry, index) => (
            <Flex
              key={index}
              role="button"
              tabIndex={0}
              draggable={!!entry}
              onDragStart={(event) => {
                setPreview(null);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(SLOT_DRAG_TYPE, String(index));
              }}
              onDragOver={(event) => {
                if (!isEntryDrag(event.dataTransfer)) return;
                event.preventDefault();
                setDropTarget(index);
              }}
              onDragLeave={() => setDropTarget((t) => (t === index ? null : t))}
              onDrop={(event) => handleDrop(event, index)}
              onMouseEnter={(event) => entry && showPreview(index, event.currentTarget)}
              onMouseLeave={hidePreview}
              onClick={() => {
                if (!entry) newEntry(index);
                else entry.rolls.forEach((roll) => rollOne(entry.name, roll));
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!entry) return;
                setPreview(null);
                setEditing({ kind: "slot", index });
              }}
              title={entry ? undefined : "拖法术进来，或点一下自编"}
              sx={{
                position: "relative",
                width: `${SLOT_SIZE}px`,
                height: `${SLOT_SIZE}px`,
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                borderRadius: "6px",
                border: entry ? "1px solid" : "1px dashed",
                borderColor: dropTarget === index ? "primary" : entry ? "border" : "muted",
                borderTop: entry?.source?.accent ? `3px solid ${entry.source.accent}` : undefined,
                bg: dropTarget === index ? "highlight" : entry ? "background" : "transparent",
                cursor: "pointer",
                overflow: "hidden",
                p: "2px",
                "&:hover": { borderColor: "primary" },
                "&:hover .slot-plus": { opacity: 1 },
              }}
            >
              <Text
                sx={{
                  position: "absolute",
                  top: "1px",
                  left: "3px",
                  fontSize: "9px",
                  color: "gray",
                  lineHeight: 1,
                }}
              >
                {index + 1}
              </Text>
              {loading === index ? (
                <Text sx={{ fontSize: 0, color: "gray" }}>…</Text>
              ) : entry ? (
                <Text
                  sx={{
                    fontSize: entry.name.length > 4 ? "10px" : "12px",
                    fontWeight: "bold",
                    lineHeight: 1.15,
                    wordBreak: "break-all",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {entry.name}
                </Text>
              ) : (
                <Text className="slot-plus" sx={{ fontSize: 3, color: "gray", opacity: 0.3 }}>
                  ＋
                </Text>
              )}
            </Flex>
          ))}
        </Flex>
      </Box>

      {previewEntry && preview && (
        <SlotPreview
          entry={previewEntry}
          rect={preview.rect}
          onEnter={keepPreview}
          onLeave={hidePreview}
          onRoll={(roll) => rollOne(previewEntry.name, roll)}
        />
      )}

      {editing && (
        <Popover>
          {editing.kind === "saves" ? (
            <SavesEditor
              saves={saves}
              system={system}
              onSave={(next) => {
                update((s) => updateGroup(s, group.id, (g) => ({ ...g, saves: next })));
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          ) : editingEntry ? (
            <EntryEditor
              key={editingEntry.id}
              entry={editingEntry}
              onSave={(next) => {
                const index = editing.index;
                setSlots((list) => list.map((e, i) => (i === index ? next : e)));
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
              onDelete={() => {
                const index = editing.index;
                setSlots((list) => list.map((e, i) => (i === index ? null : e)));
                setEditing(null);
              }}
            />
          ) : null}
        </Popover>
      )}
    </Box>
  );
}

/** A panel above the hotbar for editing */
function Popover({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        position: "absolute",
        bottom: "100%",
        left: "50%",
        transform: "translateX(-50%)",
        mb: 2,
        width: "360px",
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "70vh",
        overflowY: "auto",
        bg: "background",
        borderRadius: "8px",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
        zIndex: 2,
      }}
    >
      {children}
    </Box>
  );
}

function SavesEditor({
  saves,
  system,
  onSave,
  onCancel,
}: {
  saves: SpellRoll[];
  system: RuleSystem;
  onSave: (saves: SpellRoll[]) => void;
  onCancel: () => void;
}) {
  const [list, setList] = useState(saves);
  return (
    <Box sx={{ p: 2, border: "1px solid", borderColor: "primary", borderRadius: "8px", fontSize: 1 }}>
      <Text sx={label}>豁免（名称和公式；+5 即 1d20+5）</Text>
      <RollsEditor rolls={list} onChange={setList} addLabel="＋ 加一项豁免" />
      <Flex sx={{ mt: 2, gap: 2, alignItems: "center", flexWrap: "wrap" }}>
        <Text
          as="button"
          onClick={() => onSave(list.filter((r) => r.formula.trim()))}
          sx={{ ...chip, bg: "primary", color: "background", fontWeight: "bold" }}
        >
          保存
        </Text>
        <Text as="button" onClick={onCancel} sx={{ ...chip, bg: "muted" }}>
          取消
        </Text>
        <Text
          as="button"
          title="换成当前规则模式的豁免项（加值归零）"
          onClick={() => setList(defaultSaves(system))}
          sx={{ ...chip, bg: "transparent", color: "gray", ml: "auto" }}
        >
          用 {RULE_SYSTEM_LABEL[system]} 默认
        </Text>
      </Flex>
    </Box>
  );
}

const PREVIEW_WIDTH = 380;

/** A slot's description above it: its quick search card or note, and its formulas one by one */
function SlotPreview({
  entry,
  rect,
  onEnter,
  onLeave,
  onRoll,
}: {
  entry: SpellEntry;
  rect: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
  onRoll: (roll: SpellRoll) => void;
}) {
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - PREVIEW_WIDTH / 2),
    window.innerWidth - PREVIEW_WIDTH - 8
  );
  const bottom = window.innerHeight - rect.top + 8;
  return ReactDOM.createPortal(
    <Box
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ left, bottom, maxHeight: rect.top - 24 }}
      sx={{
        position: "fixed",
        width: `${PREVIEW_WIDTH}px`,
        overflowY: "auto",
        bg: "background",
        color: "text",
        border: "1px solid",
        borderColor: "border",
        borderRadius: "8px",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
        zIndex: 70,
      }}
    >
      {/* Formulas first: always in view */}
      <Box sx={{ p: 2, borderBottom: "1px solid", borderColor: "border", position: "sticky", top: 0, bg: "background", zIndex: 2 }}>
        {!entry.source && (
          <Text sx={{ display: "block", fontSize: 2, fontWeight: "bold", mb: 1 }}>{entry.name}</Text>
        )}
        <Flex sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          {entry.rolls.map((roll, i) => {
            const ok = !!parseFormula(roll.formula);
            return (
              <Text
                key={i}
                as="button"
                onClick={() => ok && onRoll(roll)}
                title={ok ? `只掷 ${roll.label || roll.formula}` : "公式写不对，右键格子修改"}
                sx={{
                  ...chip,
                  bg: "muted",
                  opacity: ok ? 1 : 0.5,
                  "&:hover": ok ? { bg: "primary", color: "background" } : {},
                }}
              >
                {roll.label && <b>{roll.label} </b>}
                {roll.formula}
              </Text>
            );
          })}
          <Text sx={{ fontSize: 0, color: "gray", ml: "auto" }}>点格子全掷 · 右键编辑</Text>
        </Flex>
      </Box>
      {entry.source && <SourceCard result={entry.source} />}
      {(entry.note || !entry.source) && (
        <Text
          sx={{
            display: "block",
            p: 3,
            fontSize: 1,
            whiteSpace: "pre-wrap",
            lineHeight: 1.6,
            borderTop: entry.source ? "1px solid" : "none",
            borderColor: "border",
            color: entry.note ? "text" : "gray",
          }}
        >
          {entry.note || "（没有描述，右键格子添加）"}
        </Text>
      )}
    </Box>,
    document.body
  );
}

function EntryEditor({
  entry,
  onSave,
  onCancel,
  onDelete,
}: {
  entry: SpellEntry;
  onSave: (entry: SpellEntry) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(entry.name);
  const [note, setNote] = useState(entry.note);
  const [rolls, setRolls] = useState<SpellRoll[]>(entry.rolls);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Box sx={{ my: 2, p: 2, border: "1px solid", borderColor: "primary", borderRadius: "6px", fontSize: 1 }}>
      <Text sx={label}>名字</Text>
      <Input value={name} onChange={(e) => setName(e.target.value)} sx={field} />
      <Text sx={label}>
        描述 / 备注
        {entry.source && <Text as="span" sx={{ color: "gray" }}>（悬停时显示在资料卡下面）</Text>}
      </Text>
      <Textarea value={note} rows={3} onChange={(e) => setNote(e.target.value)} sx={field} />
      <Text sx={label}>公式（如 1d20+7、+7、8d6、2d6+1d8+3）</Text>
      <RollsEditor rolls={rolls} onChange={setRolls} />
      <Flex sx={{ mt: 2, gap: 2, alignItems: "center" }}>
        <Text
          as="button"
          onClick={() =>
            onSave({
              ...entry,
              name: name.trim() || entry.name,
              note,
              rolls: rolls.filter((r) => r.formula.trim()),
            })
          }
          sx={{ ...chip, bg: "primary", color: "background", fontWeight: "bold" }}
        >
          保存
        </Text>
        <Text as="button" onClick={onCancel} sx={{ ...chip, bg: "muted" }}>
          取消
        </Text>
        <Text
          as="button"
          onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
          onMouseLeave={() => setConfirmDelete(false)}
          sx={{ ...chip, bg: confirmDelete ? "#c0392b" : "transparent", color: confirmDelete ? "white" : "gray", ml: "auto" }}
        >
          {confirmDelete ? "再点一下删除" : "删除条目"}
        </Text>
      </Flex>
    </Box>
  );
}

/** Label and formula rows, as edited for an entry or the saves */
function RollsEditor({
  rolls,
  onChange,
  addLabel = "＋ 加一个公式",
}: {
  rolls: SpellRoll[];
  onChange: (rolls: SpellRoll[]) => void;
  addLabel?: string;
}) {
  const setRoll = (i: number, change: Partial<SpellRoll>) =>
    onChange(rolls.map((r, j) => (j === i ? { ...r, ...change } : r)));
  return (
    <>
      {rolls.map((roll, i) => {
        const ok = !!parseFormula(roll.formula);
        return (
          <Flex key={i} sx={{ gap: 1, mb: 1, alignItems: "center" }}>
            <Input
              value={roll.label}
              placeholder="名称"
              onChange={(e) => setRoll(i, { label: e.target.value })}
              sx={{ ...field, width: "35%", mb: 0 }}
            />
            <Input
              value={roll.formula}
              placeholder="+5 或 1d20+5"
              onChange={(e) => setRoll(i, { formula: e.target.value })}
              sx={{ ...field, flexGrow: 1, mb: 0, borderColor: ok ? "border" : "#c0392b" }}
            />
            <Text
              as="button"
              title="删掉这一项"
              onClick={() => onChange(rolls.filter((_, j) => j !== i))}
              sx={tool}
            >
              ×
            </Text>
          </Flex>
        );
      })}
      <Text
        as="button"
        onClick={() => onChange([...rolls, { label: "", formula: "" }])}
        sx={{ ...chip, bg: "transparent", color: "primary", px: 0 }}
      >
        {addLabel}
      </Text>
    </>
  );
}

function SourceCard({ result }: { result: SearchResult }) {
  const [noCard, setNoCard] = useState(false);
  if (result.system === "pf2") return <Pf2Card result={result} />;
  if (result.system === "4e") return <Dnd4eCard result={result} />;
  if (noCard)
    return (
      <Box sx={{ p: 3, fontSize: 1 }}>
        <Text sx={{ display: "block", fontSize: 3, fontWeight: "bold" }}>{result.name}</Text>
        <Text
          as="a"
          // @ts-ignore theme-ui Text as an anchor
          href={result.url}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ color: "primary" }}
        >
          在 5etools 打开
        </Text>
      </Box>
    );
  return (
    <EntryCardView
      result={result}
      // No card in the data (or its full page link): a link instead, as
      // a hover must not open tabs
      onOpenFullPage={() => setNoCard(true)}
    />
  );
}

const chip = {
  border: "none",
  borderRadius: "4px",
  px: 2,
  py: "2px",
  fontSize: 1,
  cursor: "pointer",
  color: "text",
  fontFamily: "body",
};

const tool = {
  bg: "transparent",
  border: "none",
  color: "gray",
  cursor: "pointer",
  px: 1,
  fontSize: 1,
  "&:hover": { color: "primary" },
};

const label = { display: "block", fontSize: 0, color: "gray", mt: 1, mb: "2px" };
const field = { fontSize: 1, py: 1, mb: 1 };

export default SpellHotbar;
