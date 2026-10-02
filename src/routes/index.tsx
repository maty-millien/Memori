import { createFileRoute } from "@tanstack/react-router";

import { ChatPage } from "@/pages/chat/chat-page";
import { getMessages, loadChatOptions } from "@/server/functions";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [messages, chatOptions] = await Promise.all([getMessages(), loadChatOptions()]);
    return { messages, ...chatOptions };
  },
  component: ChatRoute,
});

function ChatRoute() {
  const { messages, models, settings } = Route.useLoaderData();
  return (
    <ChatPage initialMessages={messages} models={models} initialChatSettings={settings} />
  );
}
