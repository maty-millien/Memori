import {
  IconBrain,
  IconCheck,
  IconCopy,
  IconTerminal2,
  IconWorldSearch,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { formatSeconds } from "@/shared/lib/format";
import { messageText, type MemoriUIMessage } from "@/shared/lib/memori";
import { cn } from "@/shared/lib/utils";
import { Bubble, BubbleContent } from "@/shared/ui/bubble";
import { Button } from "@/shared/ui/button";
import { Marker, MarkerContent, MarkerIcon } from "@/shared/ui/marker";
import { Spinner } from "@/shared/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { DebugDialog } from "./debug-dialog";

type Part = MemoriUIMessage["parts"][number];

function Step({
  icon,
  running = false,
  children,
}: {
  icon?: ReactNode;
  running?: boolean;
  children: ReactNode;
}) {
  return (
    <Marker>
      <MarkerIcon>{running ? <Spinner /> : icon}</MarkerIcon>
      <MarkerContent className={cn("truncate", running && "shimmer")}>
        {children}
      </MarkerContent>
    </Marker>
  );
}

function TimelinePart({ part }: { part: Part }) {
  switch (part.type) {
    case "text":
      return (
        <Bubble variant="ghost">
          <BubbleContent>
            <div className="prose max-w-none break-words dark:prose-invert prose-h1:text-2xl prose-h1:font-semibold prose-h2:mt-8 prose-h2:mb-3 prose-h2:text-xl prose-h2:font-medium prose-h3:text-base prose-h3:font-medium prose-strong:font-medium prose-table:block prose-table:overflow-y-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>
          </BubbleContent>
        </Bubble>
      );
    case "data-thought":
      return <Step icon={<IconBrain />}>Thought for {formatSeconds(part.data.ms)}</Step>;
    case "data-command":
      return (
        <Step icon={<IconTerminal2 />} running={part.data.running}>
          {part.data.running ? "Running" : "Ran"} {part.data.command}
        </Step>
      );
    case "data-search":
      return (
        <Step icon={<IconWorldSearch />} running={part.data.running}>
          {part.data.running ? "Searching the web" : `Searched ${part.data.query}`}
        </Step>
      );
    default:
      return null;
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const Icon = copied ? IconCheck : IconCopy;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy"
            className="text-muted-foreground hover:text-foreground"
            onClick={copy}
          />
        }
      >
        <Icon className="size-5" stroke={1.75} />
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
    </Tooltip>
  );
}

export function AssistantTurn({
  message,
  streaming,
}: {
  message: MemoriUIMessage;
  streaming: boolean;
}) {
  const last = message.parts.findLast(
    (part) =>
      part.type === "text" ||
      part.type === "data-thought" ||
      part.type === "data-command" ||
      part.type === "data-search",
  );
  const thinking =
    streaming &&
    last?.type !== "text" &&
    !(
      (last?.type === "data-command" || last?.type === "data-search") &&
      last.data.running
    );
  const text = messageText(message.parts, "\n\n");

  return (
    <div className="flex w-full flex-col gap-3">
      {[...message.parts.entries()].map(([index, part]) => (
        <TimelinePart key={`${part.type}-${index}`} part={part} />
      ))}
      {thinking ? <Step running>Thinking</Step> : null}
      {streaming ? null : (
        <div className="-ml-1.5 flex">
          {text ? <CopyButton text={text} /> : null}
          <DebugDialog message={message} />
        </div>
      )}
    </div>
  );
}
