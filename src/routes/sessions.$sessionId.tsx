import { createFileRoute, notFound } from "@tanstack/react-router";

import { ChatPage } from "@/pages/chat/chat-page";
import { getSessionWithMessages } from "@/server/functions";

export const Route = createFileRoute("/sessions/$sessionId")({
  loader: async ({ params }) => {
    const data = await getSessionWithMessages({ data: params.sessionId });
    if (!data) {
      throw notFound();
    }
    return data;
  },
  component: SessionRoute,
});

function SessionRoute() {
  const { session, messages } = Route.useLoaderData();
  return <ChatPage key={session.id} session={session} initialMessages={messages} />;
}
