import React, { useState } from "react";
import { Box, Button, Flex, IconButton, Input, Link, Text } from "theme-ui";

import FloatingWindow, { besidePartyRect } from "./FloatingWindow";
import OpenInNewIcon from "../icons/OpenInNewIcon";
import LinkIcon from "../icons/LinkIcon";
import ChatIcon from "../icons/ChatIcon";
import DiscordIcon from "../icons/DiscordIcon";
import ShimoIcon from "../icons/ShimoIcon";
import { useRollTarget } from "../helpers/rollTarget";
import { loadShimoUrl, parseShimoUrl, saveShimoUrl } from "../helpers/shimo";

/** Chat page shown in the window, e.g. a same-site Boluo mirror */
export const chatUrl = process.env.REACT_APP_CHAT_URL || "";
/** Discord chat page, e.g. the same-site discord-bridge */
export const discordChatUrl = process.env.REACT_APP_DISCORD_CHAT_URL || "";
/** Shimo page the Shimo tab opens until a doc link is pasted; "off" hides it */
export const shimoUrl =
  process.env.REACT_APP_SHIMO_URL === "off"
    ? ""
    : process.env.REACT_APP_SHIMO_URL || "https://shimo.im/desktop";

export type ChatTabName = "chat" | "discordChat" | "shimo";

export type ChatTabConfig = {
  /** Also the iframe's data-chat (the Boluo / Discord roll bridges find it by this) */
  name: ChatTabName;
  title: string;
  url: string;
  popupName: string;
  /** The page can be swapped for a pasted link, kept under this localStorage key */
  urlStorageKey?: string;
};

/** The configured pages of the chat window, one tab each */
export const chatTabs: ChatTabConfig[] = [
  { name: "chat" as const, title: "Boluo", url: chatUrl, popupName: "owlbear-chat" },
  {
    name: "discordChat" as const,
    title: "Discord",
    url: discordChatUrl,
    popupName: "owlbear-discord-chat",
  },
  {
    name: "shimo" as const,
    title: "石墨",
    url: shimoUrl,
    popupName: "owlbear-shimo",
    urlStorageKey: "shimoWindow.url",
  },
].filter((tab) => tab.url);

const TAB_KEY = "chatWindow.tab";

function loadTab(): ChatTabName {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    const tab = chatTabs.find((t) => t.name === saved);
    if (tab) return tab.name;
  } catch {}
  return chatTabs[0]?.name || "chat";
}

/** Paste box for a Shimo doc link, with why logins may not stick in the frame */
function ShimoLinkBar({
  url,
  onChange,
  onOpenPopup,
}: {
  url: string;
  onChange: (url: string) => void;
  onOpenPopup: () => void;
}) {
  const [draft, setDraft] = useState(url);
  const parsed = parseShimoUrl(draft);
  const invalid = draft.trim() !== "" && !parsed;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (draft.trim() === "") onChange("");
    else if (parsed) onChange(parsed);
  }

  return (
    <Box
      as="form"
      onSubmit={handleSubmit}
      sx={{ p: 2, borderBottom: "1px solid", borderColor: "border" }}
    >
      <Flex sx={{ gap: 2 }}>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="粘贴石墨文档链接，如 https://shimo.im/docs/…"
          aria-label="石墨文档链接"
          autoFocus
          sx={{ flexGrow: 1, fontSize: 1 }}
        />
        <Button type="submit" disabled={invalid} sx={{ flexShrink: 0 }}>
          打开
        </Button>
      </Flex>
      <Text as="p" sx={{ fontSize: 0, color: invalid ? "red" : "gray", mt: 1 }}>
        {invalid
          ? "只能打开 shimo.im 的链接"
          : "留空恢复默认页。浏览器不会把石墨的登录带进内嵌窗口，看起来没登录时，把文档分享设为「获得链接的人可编辑 / 可查看」，或"}
        {!invalid && (
          <Link
            href="#"
            onClick={(event) => {
              event.preventDefault();
              onOpenPopup();
            }}
          >
            在新窗口打开
          </Link>
        )}
        {!invalid && "（新窗口里登录正常）。"}
      </Text>
    </Box>
  );
}

/** One tab's page; mounted on first visit (or preload), then kept while hidden */
function ChatFrame({ tab, active, url }: { tab: ChatTabConfig; active: boolean; url: string }) {
  return (
    <iframe
      data-chat={tab.name}
      src={url}
      title={tab.title}
      allow="clipboard-read; clipboard-write; autoplay; fullscreen"
      style={{
        flexGrow: 1,
        width: "100%",
        border: "none",
        background: "white",
        display: active ? "block" : "none",
      }}
    />
  );
}

/**
 * Boluo, Discord and Shimo in one floating window, a tab each. Pages stay
 * loaded while another tab is shown, so chats keep their place.
 */
function ChatWindow() {
  // Rolls sent to Boluo or Discord go through its page, so it loads before first open
  const rollTarget = useRollTarget();
  const preloadTab: ChatTabName | null =
    rollTarget === "boluo" ? "chat" : rollTarget === "discord" ? "discordChat" : null;
  const [active, setActive] = useState<ChatTabName>(loadTab);
  // Tabs whose page has been loaded (they stay loaded)
  const [visited, setVisited] = useState<Set<ChatTabName>>(() => new Set([loadTab()]));
  const [customUrl, setCustomUrl] = useState(() => loadShimoUrl("shimoWindow.url"));
  const [showLinkBar, setShowLinkBar] = useState(false);

  if (chatTabs.length === 0) return null;
  const current = chatTabs.find((t) => t.name === active) || chatTabs[0];
  const urlOf = (tab: ChatTabConfig) => (tab.urlStorageKey && customUrl) || tab.url;

  function choose(name: ChatTabName) {
    setActive(name);
    setVisited((prev) => new Set(prev).add(name));
    setShowLinkBar(false);
    try {
      localStorage.setItem(TAB_KEY, name);
    } catch {}
  }

  function openPopup() {
    window.open(urlOf(current), current.popupName, "popup,width=960,height=760");
  }

  function changeUrl(next: string) {
    saveShimoUrl("shimoWindow.url", next);
    setCustomUrl(next);
    setShowLinkBar(false);
  }

  return (
    <FloatingWindow
      name="chat"
      preload={preloadTab !== null}
      title="交流"
      storageKey="chatWindow.rect"
      defaultRect={() => besidePartyRect(0, 520)}
      headerActions={
        <>
          {current.urlStorageKey && (
            <IconButton
              aria-label={`Change ${current.title} Link`}
              title="换成别的石墨文档"
              aria-pressed={showLinkBar}
              onClick={() => setShowLinkBar((show) => !show)}
              sx={{ color: showLinkBar ? "primary" : "text" }}
            >
              <LinkIcon />
            </IconButton>
          )}
          <IconButton
            aria-label={`Open ${current.title} in New Window`}
            title={`在新窗口打开 ${current.title}`}
            onClick={openPopup}
          >
            <OpenInNewIcon />
          </IconButton>
        </>
      }
    >
      {chatTabs.length > 1 && (
        <Flex
          role="tablist"
          sx={{ gap: 1, px: 2, pb: 1, borderBottom: "1px solid", borderColor: "border" }}
        >
          {chatTabs.map((tab) => {
            const selected = tab.name === current.name;
            return (
              <Flex
                key={tab.name}
                as="button"
                role="tab"
                aria-selected={selected}
                onClick={() => choose(tab.name)}
                sx={{
                  alignItems: "center",
                  gap: 1,
                  px: 2,
                  py: "2px",
                  border: "none",
                  borderRadius: "4px",
                  bg: selected ? "primary" : "transparent",
                  color: selected ? "background" : "text",
                  fontWeight: selected ? "bold" : "normal",
                  fontSize: 1,
                  fontFamily: "body",
                  cursor: "pointer",
                  "& svg": { width: 16, height: 16 },
                  "&:hover": selected ? {} : { bg: "highlight" },
                }}
              >
                {tab.name === "discordChat" ? (
                  <DiscordIcon />
                ) : tab.name === "shimo" ? (
                  <ShimoIcon />
                ) : (
                  <ChatIcon />
                )}
                {tab.title}
                {preloadTab === tab.name && (
                  <Text as="span" title="掷骰结果会发到这里" sx={{ fontSize: 0 }}>
                    🎲
                  </Text>
                )}
              </Flex>
            );
          })}
        </Flex>
      )}
      {showLinkBar && current.urlStorageKey && (
        <ShimoLinkBar url={customUrl} onChange={changeUrl} onOpenPopup={openPopup} />
      )}
      {chatTabs
        .filter((tab) => visited.has(tab.name) || tab.name === preloadTab)
        .map((tab) => (
          <ChatFrame
            // A new key reloads the frame when the link changes
            key={`${tab.name}|${urlOf(tab)}`}
            tab={tab}
            active={tab.name === current.name}
            url={urlOf(tab)}
          />
        ))}
    </FloatingWindow>
  );
}

export default ChatWindow;
