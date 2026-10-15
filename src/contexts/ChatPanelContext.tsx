import React, { useContext, useState } from "react";

/** Chat page shown in the side panel, e.g. a same-site Boluo mirror */
export const chatUrl = process.env.REACT_APP_CHAT_URL || "";

type ChatPanelContextValue = {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const ChatPanelContext = React.createContext<ChatPanelContextValue | undefined>(
  undefined
);

export function ChatPanelProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <ChatPanelContext.Provider value={{ isOpen, setIsOpen }}>
      {children}
    </ChatPanelContext.Provider>
  );
}

export function useChatPanel() {
  const context = useContext(ChatPanelContext);
  if (context === undefined) {
    throw new Error("useChatPanel must be used within a ChatPanelProvider");
  }
  return context;
}
