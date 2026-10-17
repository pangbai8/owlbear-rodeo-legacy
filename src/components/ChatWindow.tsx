import React, { useState } from "react";
import { Box, Button, Flex, IconButton, Input, Link, Text } from "theme-ui";

import FloatingWindow, { besidePartyRect } from "./FloatingWindow";
import OpenInNewIcon from "../icons/OpenInNewIcon";
import LinkIcon from "../icons/LinkIcon";
import { FloatingWindowName } from "../contexts/FloatingWindowContext";
import { useRollTarget } from "../helpers/rollTarget";
import { loadShimoUrl, parseShimoUrl, saveShimoUrl } from "../helpers/shimo";

/** Chat page shown in the window, e.g. a same-site Boluo mirror */
export const chatUrl = process.env.REACT_APP_CHAT_URL || "";
/** Discord chat page, e.g. the same-site discord-bridge */
export const discordChatUrl = process.env.REACT_APP_DISCORD_CHAT_URL || "";
/** Shimo page the Shimo window opens until a doc link is pasted; "off" hides it */
export const shimoUrl =
  process.env.REACT_APP_SHIMO_URL === "off"
    ? ""
    : process.env.REACT_APP_SHIMO_URL || "https://shimo.im/desktop";

export type ChatWindowConfig = {
  name: FloatingWindowName;
  title: string;
  url: string;
  storageKey: string;
  popupName: string;
  /** Default x offset from the party sidebar, so both windows can sit side by side */
  offsetX: number;
  /** Default width */
  width?: number;
  /** The page can be swapped for a pasted link, kept under this localStorage key */
  urlStorageKey?: string;
};

/** The chat windows that are configured, each with its own sidebar button */
export const chatWindows: ChatWindowConfig[] = [
  {
    name: "chat" as const,
    title: "Boluo",
    url: chatUrl,
    storageKey: "chatWindow.rect",
    popupName: "owlbear-chat",
    offsetX: 0,
  },
  {
    name: "discordChat" as const,
    title: "Discord",
    url: discordChatUrl,
    storageKey: "discordChatWindow.rect",
    popupName: "owlbear-discord-chat",
    offsetX: 448,
  },
  {
    name: "shimo" as const,
    title: "石墨",
    url: shimoUrl,
    storageKey: "shimoWindow.rect",
    popupName: "owlbear-shimo",
    offsetX: 0,
    width: 640,
    urlStorageKey: "shimoWindow.url",
  },
].filter((chat) => chat.url);

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

function ChatFrame({ chat }: { chat: ChatWindowConfig }) {
  // Rolls sent to Boluo or Discord go through its page, so it loads before first open
  const rollTarget = useRollTarget();
  const [customUrl, setCustomUrl] = useState(() =>
    chat.urlStorageKey ? loadShimoUrl(chat.urlStorageKey) : "",
  );
  const [showLinkBar, setShowLinkBar] = useState(false);
  const url = customUrl || chat.url;

  function openPopup() {
    window.open(url, chat.popupName, "popup,width=960,height=760");
  }

  function changeUrl(next: string) {
    if (chat.urlStorageKey) saveShimoUrl(chat.urlStorageKey, next);
    setCustomUrl(next);
    setShowLinkBar(false);
  }

  return (
    <FloatingWindow
      name={chat.name}
      preload={
        (chat.name === "chat" && rollTarget === "boluo") ||
        (chat.name === "discordChat" && rollTarget === "discord")
      }
      title={chat.title}
      storageKey={chat.storageKey}
      defaultRect={() => besidePartyRect(chat.offsetX, chat.width || 440)}
      headerActions={
        <>
          {chat.urlStorageKey && (
            <IconButton
              aria-label={`Change ${chat.title} Link`}
              title="换成别的石墨文档"
              aria-pressed={showLinkBar}
              onClick={() => setShowLinkBar((show) => !show)}
              sx={{ color: showLinkBar ? "primary" : "text" }}
            >
              <LinkIcon />
            </IconButton>
          )}
          <IconButton
            aria-label={`Open ${chat.title} in New Window`}
            title={`Open ${chat.title} in New Window`}
            onClick={openPopup}
          >
            <OpenInNewIcon />
          </IconButton>
        </>
      }
    >
      {showLinkBar && (
        <ShimoLinkBar
          url={customUrl}
          onChange={changeUrl}
          onOpenPopup={openPopup}
        />
      )}
      <iframe
        // A new key reloads the frame when the link changes
        key={url}
        data-chat={chat.name}
        src={url}
        title={chat.title}
        allow="clipboard-read; clipboard-write; autoplay; fullscreen"
        style={{
          flexGrow: 1,
          width: "100%",
          border: "none",
          background: "white",
        }}
      />
    </FloatingWindow>
  );
}

function ChatWindow() {
  return (
    <>
      {chatWindows.map((chat) => (
        <ChatFrame key={chat.name} chat={chat} />
      ))}
    </>
  );
}

export default ChatWindow;
