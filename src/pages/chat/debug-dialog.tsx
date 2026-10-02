import { IconAlertCircle, IconScanTraces } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { formatDate, formatNumber, formatSeconds } from "@/shared/lib/format";
import {
  CHAT_MODELS,
  EFFORT_LABELS,
  type CallUsage,
  type MemoriUIMessage,
} from "@/shared/lib/memori";
import { cn } from "@/shared/lib/utils";

import { RetrievalTables } from "./retrieval-tables";

type Part = MemoriUIMessage["parts"][number];
type ToolPart = Extract<Part, { type: "tool-memory_upsert" | "tool-memory_delete" }>;
type DataPart<T extends Part["type"]> = Extract<Part, { type: T; data: unknown }>["data"];

function collect(parts: Part[]) {
  const trace = {
    retrieval: undefined as DataPart<"data-retrieval"> | undefined,
    prompt: undefined as string | undefined,
    curation: undefined as DataPart<"data-curation"> | undefined,
    chatReasoning: [] as string[],
    curationReasoning: [] as string[],
    tools: [] as ToolPart[],
    compaction: undefined as DataPart<"data-compaction"> | undefined,
    errors: [] as string[],
    usage: undefined as DataPart<"data-usage"> | undefined,
  };
  for (const part of parts) {
    switch (part.type) {
      case "data-retrieval":
        trace.retrieval = part.data;
        break;
      case "data-prompt":
        trace.prompt = part.data.prompt;
        break;
      case "data-curation":
        trace.curation = part.data;
        break;
      case "reasoning":
        if (part.text) {
          (trace.curation ? trace.curationReasoning : trace.chatReasoning).push(
            part.text,
          );
        }
        break;
      case "tool-memory_upsert":
      case "tool-memory_delete":
        trace.tools.push(part);
        break;
      case "data-compaction":
        trace.compaction = part.data;
        break;
      case "data-error":
        trace.errors.push(part.data.message);
        break;
      case "data-usage":
        trace.usage = part.data;
        break;
      default:
        break;
    }
  }
  return trace;
}

function hasTraceErrors(parts: Part[]) {
  return parts.some(
    (part) =>
      part.type === "data-error" || ("state" in part && part.state === "output-error"),
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
      {children}
    </pre>
  );
}

function UsageTable({ usage }: { usage: DataPart<"data-usage"> }) {
  const chatLabel =
    usage.chatModel && usage.chatEffort
      ? `Chat (${CHAT_MODELS[usage.chatModel]} ${EFFORT_LABELS[usage.chatEffort]})`
      : "Chat";
  const calls: [string, CallUsage | null][] = [
    [chatLabel, usage.chat],
    ["Curation", usage.curation],
  ];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Step</TableHead>
          <TableHead>Input</TableHead>
          <TableHead>Output</TableHead>
          <TableHead>Reasoning</TableHead>
          <TableHead>Requests</TableHead>
          <TableHead>Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Retrieval</TableCell>
          <TableCell colSpan={4} />
          <TableCell>{formatSeconds(usage.retrievalMs)}</TableCell>
        </TableRow>
        {calls.map(([label, call]) =>
          call ? (
            <TableRow key={label}>
              <TableCell>{label}</TableCell>
              <TableCell>{formatNumber(call.inputTokens)}</TableCell>
              <TableCell>{formatNumber(call.outputTokens)}</TableCell>
              <TableCell>{formatNumber(call.reasoningTokens)}</TableCell>
              <TableCell>{call.requests}</TableCell>
              <TableCell>{formatSeconds(call.ms)}</TableCell>
            </TableRow>
          ) : null,
        )}
      </TableBody>
    </Table>
  );
}

function toolResult(part: ToolPart) {
  if (part.state === "output-available") {
    return part.output;
  }
  if (part.state === "output-error") {
    return part.errorText;
  }
  return "running";
}

function ToolTable({
  tools,
  retrieval,
}: {
  tools: ToolPart[];
  retrieval: DataPart<"data-retrieval"> | undefined;
}) {
  const before = new Map(
    retrieval?.memories.map(({ memory }) => [memory.id, memory.content]) ?? [],
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tool</TableHead>
          <TableHead>ID</TableHead>
          <TableHead>Before</TableHead>
          <TableHead>After</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tools.map((part) => {
          const id = part.input?.memory_id ?? undefined;
          const upsert = part.type === "tool-memory_upsert" ? part.input : undefined;
          return (
            <TableRow key={part.toolCallId}>
              <TableCell>{part.type.replace("tool-", "")}</TableCell>
              <TableCell>{id ?? "new"}</TableCell>
              <TableCell className="min-w-48 whitespace-normal text-muted-foreground">
                {id ? before.get(id) : null}
              </TableCell>
              <TableCell className="min-w-48 whitespace-normal">
                {upsert?.content}
              </TableCell>
              <TableCell>
                {upsert ? (
                  <div className="flex gap-1">
                    <Badge variant="secondary">{upsert.importance}</Badge>
                    <Badge variant="outline">{upsert.scope}</Badge>
                  </div>
                ) : null}
              </TableCell>
              <TableCell
                className={cn(
                  "whitespace-normal",
                  part.state === "output-error" && "text-destructive",
                )}
              >
                {toolResult(part)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function DebugDialog({ message }: { message: MemoriUIMessage }) {
  const trace = collect(message.parts);
  const failed = hasTraceErrors(message.parts);

  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Details"
                  className={cn(
                    "text-muted-foreground hover:text-foreground",
                    failed && "text-destructive hover:text-destructive",
                  )}
                />
              }
            />
          }
        >
          <IconScanTraces className="size-5" stroke={1.75} />
        </TooltipTrigger>
        <TooltipContent>Details</TooltipContent>
      </Tooltip>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Turn debug</DialogTitle>
          <DialogDescription>
            {message.id}
            {message.metadata?.createdAt
              ? ` · ${formatDate(message.metadata.createdAt)}`
              : null}
          </DialogDescription>
        </DialogHeader>
        {trace.errors.map((error) => (
          <Alert key={error} variant="destructive">
            <IconAlertCircle />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ))}
        {trace.usage ? (
          <Section title="Usage">
            <UsageTable usage={trace.usage} />
          </Section>
        ) : null}
        {trace.retrieval ? (
          <Section
            title={`Retrieval: ${trace.retrieval.memories.length} memories, ${trace.retrieval.recent.length} recent and ${trace.retrieval.similar.length} similar conversations`}
          >
            <RetrievalTables data={trace.retrieval} />
          </Section>
        ) : null}
        {trace.prompt ? (
          <Section title="Chat prompt">
            <Pre>{trace.prompt}</Pre>
          </Section>
        ) : null}
        {trace.chatReasoning.length > 0 ? (
          <Section title="Chat reasoning">
            <Pre>{trace.chatReasoning.join("\n\n")}</Pre>
          </Section>
        ) : null}
        {trace.curation?.prompt ? (
          <Section title="Curation input">
            <Pre>{trace.curation.prompt}</Pre>
          </Section>
        ) : null}
        {trace.curationReasoning.length > 0 ? (
          <Section title="Curation reasoning">
            <Pre>{trace.curationReasoning.join("\n\n")}</Pre>
          </Section>
        ) : null}
        {trace.curation ? (
          <Section title="Memory changes">
            {trace.tools.length > 0 ? (
              <ToolTable tools={trace.tools} retrieval={trace.retrieval} />
            ) : (
              <p className="text-muted-foreground">No memory changes</p>
            )}
          </Section>
        ) : null}
        {trace.compaction ? (
          <Section
            title={`Episode #${trace.compaction.episodeId}, ${trace.compaction.messageCount} messages summarized`}
          >
            <p>{trace.compaction.summary}</p>
          </Section>
        ) : null}
        <Section title="Raw parts">
          <Pre>{JSON.stringify(message.parts, null, 2)}</Pre>
        </Section>
      </DialogContent>
    </Dialog>
  );
}
