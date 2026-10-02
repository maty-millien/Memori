import {
  IconAlertCircle,
  IconArchive,
  IconBulb,
  IconCircleCheck,
  IconFileText,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Markdown } from "@/shared/components/markdown";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Marker, MarkerContent, MarkerIcon } from "@/shared/components/ui/marker";
import { formatNumber, formatSeconds } from "@/shared/lib/format";
import {
  CHAT_MODELS,
  EFFORT_LABELS,
  type CallUsage,
  type MemoriUIMessage,
} from "@/shared/lib/memori";

import { RetrievalMarker } from "./retrieval-marker";
import { ToolMarker } from "./tool-marker";
import { StatusMarker, TraceMarker } from "./trace-marker";

type Usage = Extract<MemoriUIMessage["parts"][number], { type: "data-usage" }>["data"];

function formatCall(label: string, usage: CallUsage) {
  return `${label} ${formatNumber(usage.inputTokens)} in, ${formatNumber(usage.outputTokens)} out, ${formatNumber(usage.reasoningTokens)} reasoning, ${usage.requests} req, ${formatSeconds(usage.ms)}`;
}

function formatUsage(usage: Usage) {
  const chatLabel =
    usage.chatModel && usage.chatEffort
      ? `${CHAT_MODELS[usage.chatModel]} ${EFFORT_LABELS[usage.chatEffort]}`
      : "Chat";
  return [
    `Retrieval ${formatSeconds(usage.retrievalMs)}`,
    formatCall(chatLabel, usage.chat),
    usage.curation ? formatCall("Curation", usage.curation) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function AssistantTurn({
  message,
  streaming,
}: {
  message: MemoriUIMessage;
  streaming: boolean;
}) {
  const items: ReactNode[] = [];
  let curating = false;
  let retrieved = false;
  let replied = false;
  let toolCalls = 0;
  let usage: Usage | undefined;

  for (const [index, part] of message.parts.entries()) {
    switch (part.type) {
      case "data-retrieval":
        retrieved = true;
        items.push(<RetrievalMarker key={index} data={part.data} />);
        break;
      case "data-prompt":
        items.push(
          <TraceMarker key={index} icon={<IconFileText />} label="Prompt">
            <pre className="text-xs whitespace-pre-wrap">{part.data.prompt}</pre>
          </TraceMarker>,
        );
        break;
      case "reasoning":
        if (part.text || part.state === "streaming") {
          items.push(
            <TraceMarker
              key={index}
              icon={<IconBulb />}
              label={curating ? "Curation reasoning" : "Reasoning"}
              shimmer={part.state === "streaming"}
            >
              <p className="whitespace-pre-wrap">{part.text}</p>
            </TraceMarker>,
          );
        }
        break;
      case "text":
        replied = true;
        items.push(<Markdown key={index}>{part.text}</Markdown>);
        break;
      case "data-curation":
        curating = true;
        break;
      case "data-compaction":
        items.push(
          <TraceMarker
            key={index}
            icon={<IconArchive />}
            label={`Episode #${part.data.episodeId}, ${part.data.messageCount} messages summarized`}
          >
            <p>{part.data.summary}</p>
          </TraceMarker>,
        );
        break;
      case "tool-memory_upsert":
      case "tool-memory_delete":
        toolCalls += 1;
        items.push(<ToolMarker key={index} part={part} />);
        break;
      case "data-error":
        items.push(
          <Alert key={index} variant="destructive">
            <IconAlertCircle />
            <AlertTitle>Memory update failed</AlertTitle>
            <AlertDescription>{part.data.message}</AlertDescription>
          </Alert>,
        );
        break;
      case "data-usage":
        usage = part.data;
        break;
      default:
        break;
    }
  }

  if (usage?.curation && toolCalls === 0) {
    items.push(
      <Marker key="no-changes">
        <MarkerIcon>
          <IconCircleCheck />
        </MarkerIcon>
        <MarkerContent>No memory changes</MarkerContent>
      </Marker>,
    );
  }

  if (streaming && !usage) {
    const status = !retrieved
      ? "Retrieving memories"
      : curating
        ? "Curating memories"
        : replied
          ? null
          : "Thinking";
    if (status) {
      items.push(<StatusMarker key="status" label={status} />);
    }
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {items}
      {usage ? (
        <p className="text-xs text-muted-foreground">{formatUsage(usage)}</p>
      ) : null}
    </div>
  );
}
