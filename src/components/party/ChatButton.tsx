import { IconButton } from "theme-ui";

import ChatIcon from "../../icons/ChatIcon";
import { chatTabs } from "../ChatWindow";
import { useFloatingWindow } from "../../contexts/FloatingWindowContext";

/** Shows or hides the chat window (Boluo, Discord and Shimo as tabs) */
function ChatButton() {
  const { isOpen, toggle } = useFloatingWindow("chat");
  if (chatTabs.length === 0) return null;
  const names = chatTabs.map((tab) => tab.title).join(" / ");
  return (
    <IconButton
      m={1}
      aria-label={isOpen ? "Hide Chat" : "Show Chat"}
      title={isOpen ? `收起交流窗口（${names}）` : `交流窗口：${names}`}
      aria-pressed={isOpen}
      onClick={toggle}
      sx={{ color: isOpen ? "primary" : "text" }}
    >
      <ChatIcon />
    </IconButton>
  );
}

export default ChatButton;
