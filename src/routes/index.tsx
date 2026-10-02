import { createFileRoute } from "@tanstack/react-router";

import { ChatPage } from "@/pages/chat/chat-page";
import { getMessages } from "@/server/functions";

export const Route = createFileRoute("/")({
  loader: () => getMessages(),
  component: ChatRoute,
});

function ChatRoute() {
  return <ChatPage initialMessages={Route.useLoaderData()} />;
}
