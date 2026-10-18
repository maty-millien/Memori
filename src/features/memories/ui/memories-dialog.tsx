import { IconBrain, IconMessages } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { formatDate } from "@/shared/lib/format";
import type { Memory } from "@/shared/lib/memori";
import { PageHeader } from "@/shared/page-header";
import { Badge } from "@/shared/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";

function MemoryTable({ memories }: { memories: Memory[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Content</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead>Importance</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead>Last accessed</TableHead>
          <TableHead>Accesses</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {memories.map((memory) => (
          <TableRow key={memory.id}>
            <TableCell>{memory.id}</TableCell>
            <TableCell className="min-w-80 whitespace-normal">{memory.content}</TableCell>
            <TableCell>
              <Badge variant="outline">{memory.scope}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{memory.importance}</Badge>
            </TableCell>
            <TableCell>{formatDate(memory.createdAt)}</TableCell>
            <TableCell>{formatDate(memory.updatedAt)}</TableCell>
            <TableCell>{formatDate(memory.lastAccessedAt)}</TableCell>
            <TableCell>{memory.accessCount}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

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
