import { createFileRoute } from "@tanstack/react-router";

import { MemoriesPage } from "@/pages/memories/memories-page";
import { getMemories } from "@/server/functions";

export const Route = createFileRoute("/memories")({
  loader: () => getMemories(),
  component: MemoriesRoute,
});

function MemoriesRoute() {
  const { memories, conversations } = Route.useLoaderData();
  return <MemoriesPage memories={memories} conversations={conversations} />;
}
