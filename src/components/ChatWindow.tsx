import { IconButton } from "theme-ui";

import FloatingWindow, { besidePartyRect } from "./FloatingWindow";
import OpenInNewIcon from "../icons/OpenInNewIcon";

/** Chat page shown in the window, e.g. a same-site Boluo mirror */
export const chatUrl = process.env.REACT_APP_CHAT_URL || "";

function ChatWindow() {
  if (!chatUrl) {
    return null;
  }

  return (
    <FloatingWindow
      name="chat"
      title="Chat"
      storageKey="chatWindow.rect"
      defaultRect={() => besidePartyRect(0, 440)}
      headerActions={
        <IconButton
          aria-label="Open Chat in New Window"
          title="Open Chat in New Window"
          onClick={() =>
            window.open(chatUrl, "owlbear-chat", "popup,width=480,height=760")
          }
        >
          <OpenInNewIcon />
        </IconButton>
      }
    >
      <iframe
        src={chatUrl}
        title="Chat"
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

export default ChatWindow;
