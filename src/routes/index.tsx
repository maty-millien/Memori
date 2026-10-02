import { createFileRoute } from "@tanstack/react-router";

import { ChatPage } from "@/pages/chat/chat-page";
import { getMessages, loadChatSettings } from "@/server/functions";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [messages, chatSettings] = await Promise.all([
      getMessages(),
      loadChatSettings(),
    ]);
    return { messages, chatSettings };
  },
  component: ChatRoute,
});

function ChatRoute() {
  const { messages, chatSettings } = Route.useLoaderData();
  return <ChatPage initialMessages={messages} initialChatSettings={chatSettings} />;
}
