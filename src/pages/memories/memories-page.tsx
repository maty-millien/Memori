import { IconBrain, IconMessages, IconTrash } from "@tabler/icons-react";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { resetAllMemories } from "@/server/functions";
import { PageHeader } from "@/shared/components/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
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
  const router = useRouter();

  async function reset() {
    await resetAllMemories();
    await router.invalidate();
  }

  return (
    <div className="flex min-h-svh flex-col">
      <PageHeader title="Memories">
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
            <IconTrash data-icon="inline-start" />
            Reset
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset all memories?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes every memory and episode. Chat history stays.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={reset}>
                Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageHeader>
      <div className="p-4">
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
              description="Episodes appear when the chat passes half the context window."
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
