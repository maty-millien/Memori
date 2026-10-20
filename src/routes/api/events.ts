import { createFileRoute } from "@tanstack/react-router";

import { eventsResponse } from "@/features/chat/server/chat";

export const Route = createFileRoute("/api/events")({
  server: {
    handlers: {
      GET: () => eventsResponse(),
    },
  },
});
