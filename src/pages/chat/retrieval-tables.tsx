import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { formatDate, formatScore } from "@/shared/lib/format";
import type { Memory, RetrievedMemory } from "@/shared/lib/memori";

const SCORE_COLUMNS = [
  ["similarity", "Similarity"],
  ["semantic", "Semantic"],
  ["importance", "Importance"],
  ["recency", "Recency"],
  ["usage", "Usage"],
  ["scope", "Scope"],
  ["total", "Total"],
] as const;

export function RetrievalTables({
  data,
}: {
  data: { memories: RetrievedMemory[]; recent: Memory[]; similar: Memory[] };
}) {
  const conversations = [
    ...data.recent.map((memory) => ({ source: "Recent", memory })),
    ...data.similar.map((memory) => ({ source: "Similar", memory })),
  ];
  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Memory</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead>Uses</TableHead>
            {SCORE_COLUMNS.map(([key, label]) => (
              <TableHead key={key}>{label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.memories.length === 0 ? (
            <TableRow>
              <TableCell colSpan={SCORE_COLUMNS.length + 5}>
                No memories retrieved.
              </TableCell>
            </TableRow>
          ) : (
            data.memories.map(({ memory, score }) => (
              <TableRow key={memory.id}>
                <TableCell>{memory.id}</TableCell>
                <TableCell className="min-w-64 whitespace-normal">
                  {memory.content}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Badge variant="secondary">{memory.importance}</Badge>
                    <Badge variant="outline">{memory.scope}</Badge>
                  </div>
                </TableCell>
                <TableCell>{formatDate(memory.updatedAt)}</TableCell>
                <TableCell>{memory.accessCount}</TableCell>
                {SCORE_COLUMNS.map(([key]) => (
                  <TableCell key={key}>{formatScore(score[key])}</TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {conversations.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Summary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {conversations.map(({ source, memory }) => (
              <TableRow key={`${source}-${memory.id}`}>
                <TableCell>
                  <Badge variant="outline">{source}</Badge>
                </TableCell>
                <TableCell>{formatDate(memory.createdAt)}</TableCell>
                <TableCell className="min-w-64 whitespace-normal">
                  {memory.content}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
