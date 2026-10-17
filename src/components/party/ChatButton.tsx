import { IconButton } from "theme-ui";

import ChatIcon from "../../icons/ChatIcon";
import DiscordIcon from "../../icons/DiscordIcon";
import ShimoIcon from "../../icons/ShimoIcon";
import { ChatWindowConfig, chatWindows } from "../ChatWindow";
import { useFloatingWindow } from "../../contexts/FloatingWindowContext";

function ChatWindowButton({ chat }: { chat: ChatWindowConfig }) {
  const { isOpen, toggle } = useFloatingWindow(chat.name);
  const label = `${isOpen ? "Hide" : "Show"} ${chat.title}${
    chat.name === "shimo" ? "" : " Chat"
  }`;

  return (
    <IconButton
      m={1}
      aria-label={label}
      title={label}
      aria-pressed={isOpen}
      onClick={toggle}
      sx={{ color: isOpen ? "primary" : "text" }}
    >
      {chat.name === "discordChat" ? (
        <DiscordIcon />
      ) : chat.name === "shimo" ? (
        <ShimoIcon />
      ) : (
        <ChatIcon />
      )}
    </IconButton>
  );
}

/** One button per configured chat window (Boluo, Discord, Shimo) */
function ChatButton() {
  return (
    <>
      {chatWindows.map((chat) => (
        <ChatWindowButton key={chat.name} chat={chat} />
      ))}
    </>
  );
}

export default ChatButton;
