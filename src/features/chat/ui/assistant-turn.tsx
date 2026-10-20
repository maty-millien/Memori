import { IconCopy, IconScanTraces } from "@tabler/icons-react";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import { Spinner } from "@/shared/ui/spinner";

import { DebugDialog } from "./debug-dialog";
import { UserBubble } from "./user-bubble";

type Part = RemanenceUIMessage["parts"][number];

function AssistantBubble({ children }: { children: ReactNode }) {
  return (
    <Bubble variant="secondary">
      <BubbleContent>{children}</BubbleContent>
    </Bubble>
  );
}

function TypingBubble() {
  return (
    <AssistantBubble>
      <span className="flex h-7 items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-2 animate-dot-grid rounded-full bg-muted-foreground"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </span>
    </AssistantBubble>
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
      return [
        ...part.text
          .split(/\n\s*\n/)
          .filter((paragraph) => paragraph.trim())
          .entries(),
      ].map(([index, paragraph]) => (
        <AssistantBubble key={index}>
          <div className="prose max-w-none break-words dark:prose-invert prose-p:my-0 prose-a:underline-offset-2 prose-strong:font-medium prose-code:rounded-md prose-code:bg-background/70 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-pre:my-1 prose-pre:rounded-xl prose-pre:bg-background/70 prose-pre:text-foreground prose-ol:my-0 prose-ul:my-0 prose-li:my-0.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{paragraph}</ReactMarkdown>
          </div>
        </AssistantBubble>
      ));
    case "data-question":
      return part.data.answers ? (
        part.data.questions.map((question, index) => (
          <div key={question.question} className="flex flex-col gap-1">
            <AssistantBubble>{question.question}</AssistantBubble>
            {part.data.answers?.[index]?.length ? (
              <UserBubble text={part.data.answers[index].join(", ")} />
            ) : null}
          </div>
        ))
      ) : (
        <QuestionCard id={part.id ?? ""} questions={part.data.questions} />
      );
    case "data-steer":
      return <UserBubble text={part.data.text} />;
    case "data-stopped":
      return <p className="text-xs text-muted-foreground">Stopped</p>;
    default:
      return null;
  }
}

export function AssistantTurn({
  message,
  streaming,
}: {
  message: RemanenceUIMessage;
  streaming: boolean;
}) {
  const typing =
    streaming &&
    message.parts.some((part) => part.type === "data-prompt") &&
    message.parts.findLast((part) => part.type === "text")?.providerMetadata?.codex
      ?.phase !== "final_answer" &&
    !message.parts.some((part) => part.type === "data-question" && !part.data.answers);
  const text = messageText(message.parts, "\n\n");
  const [details, setDetails] = useState(false);

  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex w-full flex-col gap-2 select-text">
        {[...message.parts.entries()].map(([index, part]) => (
          <TimelinePart key={`${part.type}-${index}`} part={part} />
        ))}
        {typing ? <TypingBubble /> : null}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {text ? (
          <ContextMenuItem onClick={() => void navigator.clipboard.writeText(text)}>
            <IconCopy />
            Copy
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem disabled={streaming} onClick={() => setDetails(true)}>
          <IconScanTraces />
          Details
        </ContextMenuItem>
      </ContextMenuContent>
      <DebugDialog message={message} open={details} onOpenChange={setDetails} />
    </ContextMenu>
  );
}
