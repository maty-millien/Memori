import { createFileRoute } from "@tanstack/react-router";

import { getMessages, loadChatOptions } from "@/features/chat/server/functions";
import { ChatPage } from "@/features/chat/ui/chat-page";

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
