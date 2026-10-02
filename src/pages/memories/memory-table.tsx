import { Link } from "@tanstack/react-router";

import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { formatDate } from "@/shared/lib/format";
import type { Memory } from "@/shared/lib/memori";

export function MemoryTable({ memories }: { memories: Memory[] }) {
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
          <TableHead>Session</TableHead>
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
            <TableCell>
              {memory.sessionId ? (
                <Link to="/sessions/$sessionId" params={{ sessionId: memory.sessionId }}>
                  Open
                </Link>
              ) : (
                "None"
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
