import { IconBrain, IconMessages } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { PageHeader } from "@/shared/components/page-header";
import { Badge } from "@/shared/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import type { Memory } from "@/shared/lib/memori";

import { MemoryTable } from "./memory-table";

function MemoryList({
  memories,
  icon,
  title,
  description,
}: {
  memories: Memory[];
  icon: ReactNode;
  title: string;
  description: string;
}) {
  if (memories.length > 0) {
    return <MemoryTable memories={memories} />;
  }
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function MemoriesPage({
  memories,
  conversations,
}: {
  memories: Memory[];
  conversations: Memory[];
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader />
      <div className="mx-auto w-full max-w-5xl px-6 pt-4 pb-10">
        <h1 className="mb-6 text-3xl font-medium tracking-tight">Memories</h1>
        <Tabs defaultValue="memories">
          <TabsList>
            <TabsTrigger value="memories">
              Memories <Badge variant="secondary">{memories.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="conversations">
              Episodes <Badge variant="secondary">{conversations.length}</Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="memories">
            <MemoryList
              memories={memories}
              icon={<IconBrain />}
              title="No memories"
              description="Memories appear here once curation saves something durable."
            />
          </TabsContent>
          <TabsContent value="conversations">
            <MemoryList
              memories={conversations}
              icon={<IconMessages />}
              title="No episodes"
              description="Episodes appear when the chat passes 100k tokens of context."
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
