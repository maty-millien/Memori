import {
  IconBrain,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconFile,
  IconTerminal2,
  IconWorldSearch,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { messageText, type MemoriUIMessage } from "@/shared/lib/memori";
import { cn } from "@/shared/lib/utils";
import { Bubble, BubbleContent } from "@/shared/ui/bubble";
import { Button } from "@/shared/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@/shared/ui/marker";
import { Spinner } from "@/shared/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { DebugDialog } from "./debug-dialog";

type Part = MemoriUIMessage["parts"][number];

function duration(ms: number) {
  const seconds = ms / 1000;
  if (seconds < 2) return "a second";
  if (seconds < 10) return "a few seconds";
  if (seconds < 45) return `${Math.round(seconds / 10) * 10} seconds`;
  if (seconds < 90) return "a minute";
  return `${Math.round(seconds / 60)} minutes`;
}

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

function StepTrigger({ children }: { children: ReactNode }) {
  return (
    <CollapsibleTrigger
      render={<Marker render={<button type="button" />} />}
      className="cursor-pointer hover:text-foreground"
    >
      {children}
      <IconChevronRight className="opacity-0 transition group-hover/marker:opacity-100 group-data-[panel-open]/marker:rotate-90 group-data-[panel-open]/marker:opacity-100" />
    </CollapsibleTrigger>
  );
}

function ToolStep({
  icon,
  running,
  children,
  details,
}: {
  icon: ReactNode;
  running: boolean;
  children: ReactNode;
  details: { label: string; text: string }[];
}) {
  return (
    <Collapsible>
      <StepTrigger>
        <MarkerIcon>{running ? <Spinner /> : icon}</MarkerIcon>
        <MarkerContent className={cn("truncate", running && "shimmer")}>
          {children}
        </MarkerContent>
      </StepTrigger>
      <CollapsibleContent className="mt-2 overflow-hidden rounded-lg border bg-muted/40 text-xs">
        {details.map(({ label, text }) => (
          <div key={label} className="border-b px-3 py-2 last:border-b-0">
            <div className="mb-1 text-muted-foreground">{label}</div>
            <pre className="max-h-80 overflow-auto font-mono break-words whitespace-pre-wrap">
              {text}
            </pre>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
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
      return <Step icon={<IconBrain />}>Thought for {duration(part.data.ms)}</Step>;
    case "data-command":
      return (
        <ToolStep
          icon={<IconTerminal2 />}
          running={part.data.running}
          details={[
            { label: "Command", text: part.data.command },
            ...(part.data.running
              ? []
              : [
                  {
                    label: `Output (exit code ${part.data.exitCode})`,
                    text: part.data.output || "No output",
                  },
                ]),
          ]}
        >
          {part.data.running ? "Running a command" : "Ran a command"}
        </ToolStep>
      );
    case "data-search":
      return (
        <ToolStep
          icon={<IconWorldSearch />}
          running={part.data.running}
          details={[{ label: "Query", text: part.data.query }]}
        >
          {part.data.running ? "Searching the web" : "Searched the web"}
        </ToolStep>
      );
    case "data-read":
      return (
        <ToolStep
          icon={<IconFile />}
          running={part.data.running}
          details={[{ label: "Path", text: part.data.path }]}
        >
          {part.data.running ? "Reading a file" : "Read a file"}
        </ToolStep>
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

function isStep(part: Part) {
  return (
    part.type === "text" ||
    part.type === "data-thought" ||
    part.type === "data-command" ||
    part.type === "data-search" ||
    part.type === "data-read"
  );
}

export function AssistantTurn({
  message,
  streaming,
}: {
  message: MemoriUIMessage;
  streaming: boolean;
}) {
  const last = message.parts.findLast(isStep);
  const thinking =
    streaming &&
    last?.type !== "text" &&
    !(
      (last?.type === "data-command" ||
        last?.type === "data-search" ||
        last?.type === "data-read") &&
      last.data.running
    );
  const text = messageText(message.parts, "\n\n");
  const usage = message.parts.find((part) => part.type === "data-usage");
  const answerIndex = message.parts.findLastIndex((part) => part.type === "text");
  const timeline = [...message.parts.entries()].map(([index, part]) => (
    <TimelinePart key={`${part.type}-${index}`} part={part} />
  ));

  return (
    <div className="flex w-full flex-col gap-3">
      {!streaming &&
      usage &&
      answerIndex > 0 &&
      message.parts.slice(0, answerIndex).some(isStep) ? (
        <>
          <Collapsible>
            <StepTrigger>
              <MarkerContent>Worked for {duration(usage.data.chat.ms)}</MarkerContent>
            </StepTrigger>
            <CollapsibleContent className="mt-3 flex flex-col gap-3">
              {timeline.slice(0, answerIndex)}
            </CollapsibleContent>
          </Collapsible>
          {timeline.slice(answerIndex)}
        </>
      ) : (
        timeline
      )}
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
