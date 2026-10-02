import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const ChatBusyContext = createContext({
  busy: false,
  setBusy: (_busy: boolean) => {},
});

export function ChatBusyProvider({ children }: { children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const value = useMemo(() => ({ busy, setBusy }), [busy]);
  return <ChatBusyContext value={value}>{children}</ChatBusyContext>;
}

export function useChatBusy() {
  return useContext(ChatBusyContext);
}
