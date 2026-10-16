import { IconButton } from "theme-ui";

import FloatingWindow, { besidePartyRect } from "./FloatingWindow";
import OpenInNewIcon from "../icons/OpenInNewIcon";
import { FloatingWindowName } from "../contexts/FloatingWindowContext";
import { rollsToDiscord } from "../helpers/discordBridge";

/** Chat page shown in the window, e.g. a same-site Boluo mirror */
export const chatUrl = process.env.REACT_APP_CHAT_URL || "";
/** Discord chat page, e.g. the same-site discord-bridge */
export const discordChatUrl = process.env.REACT_APP_DISCORD_CHAT_URL || "";

export type ChatWindowConfig = {
  name: FloatingWindowName;
  title: string;
  url: string;
  storageKey: string;
  popupName: string;
  /** Default x offset from the party sidebar, so both windows can sit side by side */
  offsetX: number;
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
].filter((chat) => chat.url);

function ChatFrame({ chat }: { chat: ChatWindowConfig }) {
  return (
    <FloatingWindow
      name={chat.name}
      title={chat.title}
      storageKey={chat.storageKey}
      defaultRect={() => besidePartyRect(chat.offsetX, 440)}
      // Dice rolls from the 5e cards are sent through the Discord page
      preload={chat.name === "discordChat" && rollsToDiscord()}
      headerActions={
        <IconButton
          aria-label={`Open ${chat.title} in New Window`}
          title={`Open ${chat.title} in New Window`}
          onClick={() =>
            window.open(chat.url, chat.popupName, "popup,width=480,height=760")
          }
        >
          <OpenInNewIcon />
        </IconButton>
      }
    >
      <iframe
        src={chat.url}
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
