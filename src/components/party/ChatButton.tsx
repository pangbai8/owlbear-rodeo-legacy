import { useEffect, useRef, useState } from "react";
import { Box, Flex, IconButton, Text } from "theme-ui";

import ChatIcon from "../../icons/ChatIcon";
import DiscordIcon from "../../icons/DiscordIcon";
import ShimoIcon from "../../icons/ShimoIcon";
import { ChatWindowConfig, chatWindows } from "../ChatWindow";
import { useFloatingWindow } from "../../contexts/FloatingWindowContext";

function iconOf(chat: ChatWindowConfig) {
  return chat.name === "discordChat" ? <DiscordIcon /> : chat.name === "shimo" ? <ShimoIcon /> : <ChatIcon />;
}

/** One window's button in the row that pops out */
function ChatWindowButton({ chat, onChosen }: { chat: ChatWindowConfig; onChosen: () => void }) {
  const { isOpen, toggle } = useFloatingWindow(chat.name);
  const label = `${isOpen ? "Hide" : "Show"} ${chat.title}${chat.name === "shimo" ? "" : " Chat"}`;
  return (
    <Flex
      as="button"
      aria-label={label}
      title={isOpen ? `收起 ${chat.title}` : `打开 ${chat.title}`}
      aria-pressed={isOpen}
      onClick={() => {
        toggle();
        onChosen();
      }}
      sx={{
        flexDirection: "column",
        alignItems: "center",
        gap: "2px",
        minWidth: "52px",
        px: 1,
        py: 1,
        border: "none",
        borderRadius: "6px",
        bg: isOpen ? "highlight" : "transparent",
        color: isOpen ? "primary" : "text",
        cursor: "pointer",
        fontFamily: "body",
        "&:hover": { bg: "highlight" },
      }}
    >
      {iconOf(chat)}
      <Text sx={{ fontSize: 0, fontWeight: isOpen ? "bold" : "normal", color: "inherit" }}>{chat.title}</Text>
    </Flex>
  );
}

/** Whether any of the chat windows is open (for the main button's color) */
function useAnyOpen() {
  // The windows are a fixed list, so the hooks run in the same order
  const states = chatWindows.map((chat) => useFloatingWindow(chat.name).isOpen); // eslint-disable-line react-hooks/rules-of-hooks
  return states.some(Boolean);
}

/**
 * One sidebar button for Boluo, Discord and Shimo: a click pops out a row
 * with a button for each window.
 */
function ChatButton() {
  const [expanded, setExpanded] = useState(false);
  const anyOpen = useAnyOpen();
  const rootRef = useRef<HTMLDivElement>(null);

  // A click elsewhere or Escape folds the row
  useEffect(() => {
    if (!expanded) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setExpanded(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setExpanded(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  if (chatWindows.length === 0) return null;
  // Just one window: no row to open
  if (chatWindows.length === 1) return <SingleButton chat={chatWindows[0]} />;

  const names = chatWindows.map((chat) => chat.title).join(" / ");
  return (
    <Box ref={rootRef} sx={{ position: "relative" }}>
      <IconButton
        m={1}
        aria-label="Chat Windows"
        aria-haspopup="true"
        aria-expanded={expanded}
        title={`交流：${names}`}
        onClick={() => setExpanded((open) => !open)}
        sx={{ color: anyOpen || expanded ? "primary" : "text" }}
      >
        <ChatIcon />
      </IconButton>
      {expanded && (
        <Flex
          sx={{
            position: "absolute",
            left: "100%",
            top: "50%",
            transform: "translateY(-50%)",
            ml: 1,
            gap: 1,
            p: 1,
            bg: "background",
            border: "1px solid",
            borderColor: "border",
            borderRadius: "8px",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
            zIndex: 60,
          }}
        >
          {chatWindows.map((chat) => (
            <ChatWindowButton key={chat.name} chat={chat} onChosen={() => setExpanded(false)} />
          ))}
        </Flex>
      )}
    </Box>
  );
}

function SingleButton({ chat }: { chat: ChatWindowConfig }) {
  const { isOpen, toggle } = useFloatingWindow(chat.name);
  return (
    <IconButton
      m={1}
      aria-label={`${isOpen ? "Hide" : "Show"} ${chat.title}`}
      title={chat.title}
      aria-pressed={isOpen}
      onClick={toggle}
      sx={{ color: isOpen ? "primary" : "text" }}
    >
      {iconOf(chat)}
    </IconButton>
  );
}

export default ChatButton;
