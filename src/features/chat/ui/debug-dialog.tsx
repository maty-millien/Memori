import { IconAlertCircle, IconChevronRight, IconScanTraces } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { formatDate, formatNumber, formatSeconds } from "@/shared/lib/format";
import {
  effortLabel,
  type CallUsage,
  type Conversation,
  type Memory,
  type MemoryOperation,
  type MemoriUIMessage,
  type RetrievedMemory,
} from "@/shared/lib/memori";
import { cn } from "@/shared/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

type Part = MemoriUIMessage["parts"][number];
type DataPart<T extends Part["type"]> = Extract<Part, { type: T; data: unknown }>["data"];

const SCORE_COLUMNS = [
  ["semantic", "Semantic"],
  ["importance", "Importance"],
  ["recency", "Recency"],
  ["usage", "Usage"],
  ["scope", "Scope"],
  ["total", "Total"],
] as const;

function collect(parts: Part[]) {
  const trace = {
    retrieval: undefined as DataPart<"data-retrieval"> | undefined,
    prompt: undefined as string | undefined,
    curation: undefined as DataPart<"data-curation"> | undefined,
    reasoning: [] as string[],
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
          trace.reasoning.push(part.text);
        }
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

function callSummary(call: CallUsage) {
  return [
    `${formatNumber(call.inputTokens)} in (${formatNumber(call.cachedTokens)} cached)`,
    `${formatNumber(call.outputTokens)} out (${formatNumber(call.reasoningTokens)} reasoning)`,
    formatSeconds(call.ms),
  ].join(" · ");
}

function Section({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 border-t pt-4">
      <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">{title}</span>
        {summary ? (
          <span className="text-xs text-muted-foreground">{summary}</span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <IconChevronRight className="size-4 transition group-data-[panel-open]:rotate-90" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
          {text}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Category({ importance, scope }: Pick<Memory, "importance" | "scope">) {
  return (
    <div className="flex gap-1">
      <Badge variant="secondary">{importance}</Badge>
      <Badge variant="outline">{scope}</Badge>
    </div>
  );
}

function MemoryTable({ memories }: { memories: RetrievedMemory[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Memory</TableHead>
          <TableHead>Category</TableHead>
          {SCORE_COLUMNS.map(([key, label]) => (
            <TableHead key={key} className="text-right">
              {label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {memories.map(({ memory, score }) => (
          <TableRow key={memory.id}>
            <TableCell className="min-w-64 whitespace-normal">{memory.content}</TableCell>
            <TableCell>
              <Category importance={memory.importance} scope={memory.scope} />
            </TableCell>
            {SCORE_COLUMNS.map(([key]) => (
              <TableCell
                key={key}
                className={cn(
                  "text-right tabular-nums",
                  key === "total" ? "font-medium" : "text-muted-foreground",
                )}
              >
                {score[key].toFixed(2)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ConversationTable({
  latest,
  relevant,
}: {
  latest: Conversation[];
  relevant: Conversation[];
}) {
  const conversations = [
    ...latest.map((conversation) => ({ source: "Latest", conversation })),
    ...relevant.map((conversation) => ({ source: "Relevant", conversation })),
  ];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Conversation</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Period</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {conversations.map(({ source, conversation }) => (
          <TableRow key={`${source}-${conversation.id}`}>
            <TableCell className="min-w-64 whitespace-normal">
              {conversation.content}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{source}</Badge>
            </TableCell>
            <TableCell>
              {formatDate(conversation.startedAt)} - {formatDate(conversation.endedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function OperationTable({
  operations,
  retrieval,
}: {
  operations: MemoryOperation[];
  retrieval: DataPart<"data-retrieval"> | undefined;
}) {
  const before = new Map(
    retrieval?.memories.map(({ memory }) => [memory.id, memory.content]) ?? [],
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Before</TableHead>
          <TableHead>After</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {operations.map((operation) => (
          <TableRow
            key={`${operation.action}-${operation.memory_id}-${operation.content}`}
          >
            <TableCell className="min-w-48 whitespace-normal text-muted-foreground">
              {operation.memory_id ? before.get(operation.memory_id) : null}
            </TableCell>
            <TableCell className="min-w-48 whitespace-normal">
              {operation.content}
            </TableCell>
            <TableCell>
              {operation.importance && operation.scope ? (
                <Category importance={operation.importance} scope={operation.scope} />
              ) : null}
            </TableCell>
            <TableCell className="whitespace-normal">{operation.result}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function DebugDialog({ message }: { message: MemoriUIMessage }) {
  const { retrieval, prompt, curation, reasoning, compaction, errors, usage } = collect(
    message.parts,
  );
  const failed = errors.length > 0;

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
          <DialogTitle>Turn details</DialogTitle>
          {message.metadata?.createdAt ? (
            <DialogDescription>
              {formatDate(message.metadata.createdAt)}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {errors.map((error) => (
          <Alert key={error} variant="destructive">
            <IconAlertCircle />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ))}
        {retrieval ? (
          <Section
            title="Retrieval"
            summary={[
              `${retrieval.memories.length} memories`,
              `${retrieval.latest.length + retrieval.relevant.length} conversations`,
              usage ? formatSeconds(usage.retrievalMs) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            {retrieval.memories.length > 0 ? (
              <MemoryTable memories={retrieval.memories} />
            ) : null}
            {retrieval.latest.length + retrieval.relevant.length > 0 ? (
              <ConversationTable
                latest={retrieval.latest}
                relevant={retrieval.relevant}
              />
            ) : null}
          </Section>
        ) : null}
        {prompt || reasoning.length > 0 ? (
          <Section
            title="Chat"
            summary={
              usage
                ? `${usage.chatModel} ${effortLabel(usage.chatEffort)} · ${callSummary(usage.chat)}`
                : undefined
            }
          >
            {prompt ? <TextBlock label="Prompt" text={prompt} /> : null}
            {reasoning.length > 0 ? (
              <TextBlock label="Reasoning" text={reasoning.join("\n\n")} />
            ) : null}
          </Section>
        ) : null}
        {curation ? (
          <Section
            title="Curation"
            summary={usage?.curation ? callSummary(usage.curation) : undefined}
          >
            {curation.operations.length > 0 ? (
              <OperationTable operations={curation.operations} retrieval={retrieval} />
            ) : (
              <p className="text-sm text-muted-foreground">No memory changes</p>
            )}
            <TextBlock label="Prompt" text={curation.prompt} />
          </Section>
        ) : null}
        {compaction ? (
          <Section
            title="Compaction"
            summary={`${compaction.messageCount} messages summarized`}
          >
            <p className="text-sm">{compaction.summary}</p>
          </Section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
