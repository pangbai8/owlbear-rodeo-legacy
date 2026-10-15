import { IconButton } from "theme-ui";

import ChatIcon from "../../icons/ChatIcon";
import { chatUrl, useChatPanel } from "../../contexts/ChatPanelContext";

function ChatButton() {
  const { isOpen, setIsOpen } = useChatPanel();

  if (!chatUrl) {
    return null;
  }

  return (
    <IconButton
      m={1}
      aria-label={isOpen ? "Hide Chat" : "Show Chat"}
      title={isOpen ? "Hide Chat" : "Show Chat"}
      aria-pressed={isOpen}
      onClick={() => setIsOpen((open) => !open)}
      sx={{ color: isOpen ? "primary" : "text" }}
    >
      <ChatIcon />
    </IconButton>
  );
}

export default ChatButton;
