import { createFileRoute } from "@tanstack/react-router";

import { getMemories } from "@/features/memories/server/functions";
import { MemoriesPage } from "@/features/memories/ui/memories-page";

export const Route = createFileRoute("/memories")({
  loader: () => getMemories(),
  component: MemoriesRoute,
});

function MemoriesRoute() {
  const { memories, conversations } = Route.useLoaderData();
  return <MemoriesPage memories={memories} conversations={conversations} />;
}
