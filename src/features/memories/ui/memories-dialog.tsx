import { IconBrain, IconMessages } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { formatDate } from "@/shared/lib/format";
import type { Episode, Memory } from "@/shared/lib/memori";
import { Badge } from "@/shared/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
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

function EpisodeTable({ episodes }: { episodes: Episode[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Content</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {episodes.map((episode) => (
          <TableRow key={episode.id}>
            <TableCell>{episode.id}</TableCell>
            <TableCell className="min-w-80 whitespace-pre-line">
              {episode.content}
            </TableCell>
            <TableCell>{formatDate(episode.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function List({
  children,
  icon,
  title,
  description,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  if (children) {
    return children;
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

export function MemoriesDialog({
  open,
  onOpenChange,
  memories,
  conversations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memories: Memory[];
  conversations: Episode[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90svh] flex-col sm:max-w-7xl">
        <DialogHeader>
          <DialogTitle>Memories</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="memories" className="min-h-0 min-w-0 flex-1">
          <TabsList>
            <TabsTrigger value="memories">Memories ・{memories.length}</TabsTrigger>
            <TabsTrigger value="conversations">
              Episodes ・{conversations.length}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="memories" className="min-h-0 overflow-y-auto">
            <List
              icon={<IconBrain />}
              title="No memories"
              description="Memories appear here once curation saves something durable."
            >
              {memories.length > 0 && <MemoryTable memories={memories} />}
            </List>
          </TabsContent>
          <TabsContent value="conversations" className="min-h-0 overflow-y-auto">
            <List
              icon={<IconMessages />}
              title="No episodes"
              description="Episodes appear when the chat passes 100k tokens of context."
            >
              {conversations.length > 0 && <EpisodeTable episodes={conversations} />}
            </List>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
