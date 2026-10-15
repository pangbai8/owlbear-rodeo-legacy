import { IconButton } from "theme-ui";

import ChatIcon from "../../icons/ChatIcon";
import { chatUrl } from "../ChatWindow";
import { useFloatingWindow } from "../../contexts/FloatingWindowContext";

function ChatButton() {
  const { isOpen, toggle } = useFloatingWindow("chat");

  if (!chatUrl) {
    return null;
  }

  return (
    <IconButton
      m={1}
      aria-label={isOpen ? "Hide Chat" : "Show Chat"}
      title={isOpen ? "Hide Chat" : "Show Chat"}
      aria-pressed={isOpen}
      onClick={toggle}
      sx={{ color: isOpen ? "primary" : "text" }}
    >
      <ChatIcon />
    </IconButton>
  );
}

export default ChatButton;
