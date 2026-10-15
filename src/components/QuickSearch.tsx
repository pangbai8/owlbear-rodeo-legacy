import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex, IconButton, Input, Text } from "theme-ui";

import SearchIcon from "../icons/SearchIcon";
import OpenInNewIcon from "../icons/OpenInNewIcon";
import MonsterCard from "./MonsterCard";
import { useFloatingWindow } from "../contexts/FloatingWindowContext";
import EntryCardView from "./EntryCardView";
import { hasEntryCard } from "../helpers/fiveEEntries";
import {
  MONSTER_DRAG_TYPE,
  SearchResult,
  loadMonster,
  loadSearchIndex,
  monsterRefOf,
  searchFiveE,
} from "../helpers/fiveETools";

/**
 * Small search bar at the top of the game page for the Chinese 5etools site:
 * results expand below it, a click shows the page, and monsters can be
 * dragged onto the map (as a token) or into the party status panel.
 */
const VISIBLE_KEY = "quickSearch.visible";

function QuickSearch() {
  // The sidebar's search button shows or hides the bar (remembered per browser)
  const { isOpen: visible, setIsOpen: setVisible } =
    useFloatingWindow("quickSearch");
  // Latest setter for the window-level Ctrl+K listener (registered once)
  const setVisibleRef = useRef(setVisible);
  setVisibleRef.current = setVisible;
  // Set while restoring the saved choice, so that does not grab the focus
  const restoring = useRef(true);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(VISIBLE_KEY);
    } catch {}
    if (stored === "false") restoring.current = false;
    else setVisible(true);
    // Run once: restore the saved choice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  // Monsters show a compact stat card; other entries (or "full page") show
  // the 5etools page itself, which needs a wide panel for its desktop layout
  const [fullPage, setFullPage] = useState(false);
  const selectedMonster = useMemo(
    () => (selected?.isMonster ? monsterRefOf(selected) : null),
    [selected]
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchId = useRef(0);
  // Enter pressed before the results arrived: open the first one when they do
  const openFirstRef = useRef(false);
  const [pageLoading, setPageLoading] = useState(false);

  // Search as you type (the index loads on first use)
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const id = ++searchId.current;
    setStatus("loading");
    const timer = setTimeout(() => {
      searchFiveE(q)
        .then((found) => {
          if (id !== searchId.current) return;
          setResults(found);
          if (openFirstRef.current && found[0]) {
            setSelected(found[0]);
            setFullPage(false);
            setPageLoading(true);
          }
          openFirstRef.current = false;
          setStatus("idle");
        })
        .catch(() => {
          if (id === searchId.current) setStatus("error");
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  // Showing the bar (button or Ctrl+K) puts the cursor in it
  useEffect(() => {
    if (restoring.current) {
      // The first render (hidden), then the restored "shown"
      if (visible) restoring.current = false;
      return;
    }
    try {
      localStorage.setItem(VISIBLE_KEY, String(visible));
    } catch {}
    if (visible) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [visible]);

  // Ctrl+K shows and focuses the bar; Esc or a click elsewhere folds it
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setVisibleRef.current(true);
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  function handleFocus() {
    setOpen(true);
    loadSearchIndex().catch(() => setStatus("error"));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (selected) select(null);
      else {
        setOpen(false);
        inputRef.current?.blur();
      }
    } else if (event.key === "Enter") {
      if (status === "loading" || !results[0]) openFirstRef.current = true;
      else select(results[0]);
    }
  }

  function handleDragStart(
    event: React.DragEvent<HTMLDivElement>,
    result: SearchResult
  ) {
    const ref = monsterRefOf(result);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(MONSTER_DRAG_TYPE, JSON.stringify(ref));
    event.dataTransfer.setData("text/plain", result.name);
    event.dataTransfer.setData("text/uri-list", result.url);
  }

  const showPanel = open && (query.trim() !== "" || selected !== null);
  // Monsters, spells, items, ... get a card of their own; the rest (classes,
  // books, ...) and "full page" show the 5etools page
  const hasCard = selected !== null && (!!selectedMonster || hasEntryCard(selected));
  const showPage = selected !== null && (!hasCard || fullPage);
  const openFullPage = () => {
    setPageLoading(true);
    setFullPage(true);
  };

  function select(result: SearchResult | null) {
    setSelected(result);
    setFullPage(false);
    setPageLoading(true);
  }

  if (!visible) {
    return null;
  }

  return (
    <Box
      ref={rootRef}
      sx={{
        position: "fixed",
        top: "8px",
        left: "50%",
        transform: "translateX(-50%)",
        width: showPanel
          ? showPage
            ? "min(1180px, calc(100vw - 32px))"
            : "min(460px, calc(100vw - 32px))"
          : "260px",
        transition: "width 0.15s",
        zIndex: 50,
      }}
    >
      <Flex
        sx={{
          alignItems: "center",
          bg: "overlay",
          borderRadius: showPanel ? "8px 8px 0 0" : "8px",
          border: "1px solid",
          borderColor: "border",
          px: 2,
        }}
      >
        <SearchIcon />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            select(null);
            setOpen(true);
          }}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder="查 5e 资料：怪物、法术、物品…（Ctrl+K）"
          aria-label="Search 5etools"
          sx={{
            border: "none",
            bg: "transparent",
            fontSize: 1,
            py: 1,
            "&:focus": { outline: "none" },
          }}
        />
        {query && (
          <IconButton
            aria-label="Clear Search"
            title="清空"
            onClick={() => {
              setQuery("");
              select(null);
              inputRef.current?.focus();
            }}
            sx={{ width: "24px", height: "24px" }}
          >
            ×
          </IconButton>
        )}
      </Flex>
      {showPanel && (
        <Box
          sx={{
            bg: "background",
            border: "1px solid",
            borderColor: "border",
            borderTop: "none",
            borderRadius: "0 0 8px 8px",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
            overflow: "hidden",
          }}
        >
          {selected ? (
            <Flex
              sx={{
                flexDirection: "column",
                height: showPage ? "min(85vh, 900px)" : "min(70vh, 640px)",
              }}
            >
              <Flex
                sx={{
                  alignItems: "center",
                  px: 2,
                  py: 1,
                  borderBottom: "1px solid",
                  borderColor: "border",
                }}
              >
                <Text
                  as="button"
                  onClick={() =>
                    fullPage && hasCard
                      ? setFullPage(false)
                      : select(null)
                  }
                  sx={{
                    bg: "transparent",
                    border: "none",
                    color: "primary",
                    cursor: "pointer",
                    fontSize: 1,
                    mr: 2,
                  }}
                >
                  {fullPage && hasCard ? "← 详情" : "← 结果"}
                </Text>
                <Text sx={{ flexGrow: 1, fontSize: 1 }} title={selected.url}>
                  {selected.name}
                </Text>
                <IconButton
                  aria-label="Open in New Tab"
                  title="在新标签页打开"
                  onClick={() =>
                    window.open(selected.url, "_blank", "noopener")
                  }
                >
                  <OpenInNewIcon />
                </IconButton>
              </Flex>
              {showPage ? (
                <Box sx={{ flexGrow: 1, position: "relative" }}>
                  {/* 5etools loads its whole data set first, so say so */}
                  {pageLoading && (
                    <Text
                      sx={{
                        position: "absolute",
                        top: "40%",
                        width: "100%",
                        textAlign: "center",
                        fontSize: 1,
                        color: "gray",
                      }}
                    >
                      正在打开 5etools 页面（首次较慢，约 10–20 秒）…
                    </Text>
                  )}
                  <iframe
                    key={selected.url}
                    src={selected.url}
                    title={selected.name}
                    onLoad={() => setPageLoading(false)}
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      border: "none",
                      background: "transparent",
                    }}
                  />
                </Box>
              ) : (
                <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
                  {selectedMonster ? (
                    <MonsterCard
                      monster={selectedMonster}
                      onOpenFullPage={openFullPage}
                    />
                  ) : (
                    <EntryCardView
                      result={selected}
                      onOpenFullPage={openFullPage}
                    />
                  )}
                </Box>
              )}
            </Flex>
          ) : (
            <Box sx={{ maxHeight: "min(60vh, 520px)", overflowY: "auto" }}>
              {status === "error" && (
                <Text sx={{ p: 2, fontSize: 1 }}>
                  加载 5etools 失败，请检查网络后再试。
                </Text>
              )}
              {status !== "error" && results.length === 0 && (
                <Text sx={{ p: 2, fontSize: 1, color: "gray" }}>
                  {status === "loading" ? "正在搜索…" : "没有找到结果"}
                </Text>
              )}
              {results.map((result) => (
                <Flex
                  key={result.id}
                  role="button"
                  tabIndex={0}
                  draggable={result.isMonster}
                  onDragStart={(e) => handleDragStart(e, result)}
                  // Removing the row mid-drag can cancel it, so fold afterwards
                  onDragEnd={() => setOpen(false)}
                  onMouseEnter={() =>
                    // Warm up the stats so a drop is quick
                    result.isMonster &&
                    loadMonster(monsterRefOf(result)).catch(() => {})
                  }
                  onClick={() => select(result)}
                  onKeyDown={(e) => e.key === "Enter" && select(result)}
                  title={
                    result.isMonster
                      ? "点击查看；拖到地图变成棋子，或拖进小队状态面板"
                      : "点击查看"
                  }
                  sx={{
                    alignItems: "center",
                    px: 2,
                    py: "6px",
                    cursor: result.isMonster ? "grab" : "pointer",
                    opacity: result.reprinted ? 0.6 : 1,
                    borderBottom: "1px solid",
                    borderColor: "muted",
                    "&:hover, &:focus": { bg: "highlight", outline: "none" },
                  }}
                >
                  <Text
                    sx={{
                      fontSize: 0,
                      px: 1,
                      mr: 2,
                      borderRadius: "4px",
                      bg: result.isMonster ? "primary" : "muted",
                      color: result.isMonster ? "background" : "text",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {result.categoryLabel}
                  </Text>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Text
                      sx={{
                        fontSize: 1,
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {result.name}
                      {result.englishName && (
                        <Text as="span" sx={{ fontSize: 0, color: "gray", ml: 1 }}>
                          {result.englishName}
                        </Text>
                      )}
                    </Text>
                  </Box>
                  <Text
                    sx={{ fontSize: 0, color: "gray", ml: 2, whiteSpace: "nowrap" }}
                    title={result.reprinted ? "已在新版书中重印" : undefined}
                  >
                    {result.source}
                    {result.isMonster && " ⠿"}
                  </Text>
                </Flex>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

export default QuickSearch;
