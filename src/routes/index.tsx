import { createFileRoute, redirect } from "@tanstack/react-router";

import { getActiveSessionId } from "@/server/functions";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    throw redirect({
      to: "/sessions/$sessionId",
      params: { sessionId: await getActiveSessionId() },
    });
  },
});
