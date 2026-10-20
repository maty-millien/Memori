import {
  IconBrain,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconFile,
  IconFileDiff,
  IconHistory,
  IconMessageQuestion,
  IconPlayerStopFilled,
  IconTerminal2,
  IconWorldSearch,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { sendAnswers } from "@/features/chat/server/functions";
import {
  messageText,
  type RemanenceUIMessage,
  type Question,
} from "@/shared/lib/remanence";
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

type Part = RemanenceUIMessage["parts"][number];

function duration(ms: number) {
  const seconds = ms / 1000;
  if (seconds < 2) return "a second";
  if (seconds < 10) return "a few seconds";
  if (seconds < 45) return `${Math.round(seconds / 10) * 10} seconds`;
  if (seconds < 90) return "a minute";
  return `${Math.round(seconds / 60)} minutes`;
}

function DotGrid() {
  return (
    <span className="grid size-4 grid-cols-3 place-content-center gap-0.5">
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className="size-[3px] animate-dot-grid rounded-full bg-foreground"
          style={{ animationDelay: `${((i % 3) + Math.floor(i / 3)) * 0.12}s` }}
        />
      ))}
    </span>
  );
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
      <MarkerIcon>{running ? <DotGrid /> : icon}</MarkerIcon>
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
        <MarkerIcon>{running ? <DotGrid /> : icon}</MarkerIcon>
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

function QuestionCard({ id, questions }: { id: string; questions: Question[] }) {
  const [selected, setSelected] = useState<string[][]>(() => questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(() => questions.map(() => ""));
  const [sending, setSending] = useState(false);
  const answers = questions.map((_, index) => [
    ...selected[index],
    ...(custom[index].trim() ? [custom[index].trim()] : []),
  ]);

  function choose(index: number, label: string) {
    const { multiple } = questions[index];
    const labels = selected[index];
    setSelected(
      selected.with(
        index,
        !multiple
          ? [label]
          : labels.includes(label)
            ? labels.filter((other) => other !== label)
            : [...labels, label],
      ),
    );
    if (!multiple) {
      setCustom(custom.with(index, ""));
    }
  }

  return (
    <div className="flex flex-col gap-5 rounded-2xl border bg-popover p-4">
      {questions.map((question, index) => (
        <div key={question.question} className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground">{question.header}</div>
          <div>{question.question}</div>
          {question.options.map((option) => (
            <button
              key={option.label}
              type="button"
              className={cn(
                "cursor-pointer rounded-xl border px-3 py-2 text-left text-sm transition hover:bg-accent",
                selected[index].includes(option.label) && "border-primary bg-accent",
              )}
              onClick={() => choose(index, option.label)}
            >
              <div>{option.label}</div>
              <div className="text-muted-foreground">{option.description}</div>
            </button>
          ))}
          <input
            value={custom[index]}
            placeholder="Type your own answer"
            className="rounded-xl border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
            onChange={(event) => {
              setCustom(custom.with(index, event.target.value));
              if (!question.multiple) {
                setSelected(selected.with(index, []));
              }
            }}
          />
        </div>
      ))}
      <Button
        className="self-end rounded-full"
        disabled={sending || answers.some((answer) => answer.length === 0)}
        onClick={() => {
          setSending(true);
          void sendAnswers({ data: { id, answers } });
        }}
      >
        {sending ? <Spinner /> : "Send"}
      </Button>
    </div>
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
          details={[
            part.data.url
              ? { label: "URL", text: part.data.url }
              : { label: "Query", text: part.data.query },
          ]}
        >
          {part.data.running
            ? "Searching the web"
            : part.data.url
              ? "Opened a page"
              : "Searched the web"}
        </ToolStep>
      );
    case "data-patch":
      return (
        <ToolStep
          icon={<IconFileDiff />}
          running={part.data.running}
          details={[
            { label: "Patch", text: part.data.patch },
            ...(part.data.running ? [] : [{ label: "Result", text: part.data.output }]),
          ]}
        >
          {part.data.running ? "Editing files" : "Edited files"}
        </ToolStep>
      );
    case "data-question":
      return part.data.answers ? (
        <ToolStep
          icon={<IconMessageQuestion />}
          running={false}
          details={part.data.questions.map((question, index) => ({
            label: question.question,
            text: part.data.answers?.[index]?.join(", ") || "Unanswered",
          }))}
        >
          {part.data.questions.length === 1 ? "Asked a question" : "Asked questions"}
        </ToolStep>
      ) : (
        <QuestionCard id={part.id ?? ""} questions={part.data.questions} />
      );
    case "data-steer":
      return (
        <Bubble variant="secondary" align="end" className="max-w-[70%] self-end">
          <BubbleContent className="whitespace-pre-wrap">{part.data.text}</BubbleContent>
        </Bubble>
      );
    case "data-stopped":
      return <Step icon={<IconPlayerStopFilled />}>Stopped</Step>;
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
    case "data-recall":
      return (
        <ToolStep
          icon={<IconHistory />}
          running={part.data.running}
          details={[{ label: "Query", text: part.data.query }]}
        >
          {part.data.running ? "Searching earlier messages" : "Searched earlier messages"}
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
    part.type === "data-read" ||
    part.type === "data-recall" ||
    part.type === "data-patch" ||
    part.type === "data-question"
  );
}

export function AssistantTurn({
  message,
  streaming,
}: {
  message: RemanenceUIMessage;
  streaming: boolean;
}) {
  const last = message.parts.findLast(isStep);
  const thinking =
    streaming &&
    last?.type !== "text" &&
    !(
      (last?.type === "data-command" ||
        last?.type === "data-search" ||
        last?.type === "data-read" ||
        last?.type === "data-recall" ||
        last?.type === "data-patch") &&
      last.data.running
    ) &&
    !(last?.type === "data-question" && !last.data.answers);
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
