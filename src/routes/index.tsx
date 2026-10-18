import { createFileRoute } from "@tanstack/react-router";

import { getMessages, loadChatOptions } from "@/features/chat/server/functions";
import { ChatPage } from "@/features/chat/ui/chat-page";
import { getMemories } from "@/features/memories/server/functions";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [messages, chatOptions, memories] = await Promise.all([
      getMessages(),
      loadChatOptions(),
      getMemories(),
    ]);
    return { messages, ...chatOptions, ...memories };
  },
  component: ChatRoute,
});

function ChatRoute() {
  const { messages, models, settings, memories, conversations } = Route.useLoaderData();
  return (
    <ChatPage
      initialMessages={messages}
      models={models}
      initialChatSettings={settings}
      memories={memories}
      conversations={conversations}
    />
  );
}
