import { IconBrain, IconTerminal2 } from "@tabler/icons-react";

import { Markdown } from "@/shared/components/markdown";
import { Bubble, BubbleContent } from "@/shared/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/shared/components/ui/marker";
import { formatSeconds } from "@/shared/lib/format";
import type { MemoriUIMessage } from "@/shared/lib/memori";

import { CopyButton } from "./copy-button";
import { DebugDialog } from "./debug-dialog";
import { StatusMarker } from "./trace-marker";

type Item =
  | { key: string; kind: "text"; text: string }
  | { key: string; kind: "thought"; ms: number }
  | { key: string; kind: "shell"; command: string; done: boolean };

function timeline(message: MemoriUIMessage) {
  const items: Item[] = [];
  for (const [index, part] of message.parts.entries()) {
    if (part.type === "data-curation") {
      break;
    }
    const last = items.at(-1);
    if (part.type === "text") {
      if (last?.kind === "text") {
        last.text += `\n\n${part.text}`;
      } else {
        items.push({ key: `text-${index}`, kind: "text", text: part.text });
      }
    }
    if (part.type === "data-thought") {
      items.push({ key: `thought-${index}`, kind: "thought", ms: part.data.ms });
    }
    if (part.type === "tool-shell") {
      items.push({
        key: part.toolCallId,
        kind: "shell",
        command: part.input?.command ?? "",
        done: part.state === "output-available" || part.state === "output-error",
      });
    }
  }
  return items;
}

function TimelineItem({ item }: { item: Item }) {
  if (item.kind === "text") {
    return (
      <Bubble variant="ghost">
        <BubbleContent>
          <Markdown>{item.text}</Markdown>
        </BubbleContent>
      </Bubble>
    );
  }
  if (item.kind === "thought") {
    return (
      <Marker>
        <MarkerIcon>
          <IconBrain />
        </MarkerIcon>
        <MarkerContent>Thought for {formatSeconds(item.ms)}</MarkerContent>
      </Marker>
    );
  }
  if (!item.done) {
    return <StatusMarker label={`Running ${item.command}`} />;
  }
  return (
    <Marker>
      <MarkerIcon>
        <IconTerminal2 />
      </MarkerIcon>
      <MarkerContent>Ran {item.command}</MarkerContent>
    </Marker>
  );
}

export function AssistantTurn({
  message,
  streaming,
}: {
  message: MemoriUIMessage;
  streaming: boolean;
}) {
  const items = timeline(message);
  const last = items.at(-1);
  const thinking =
    streaming &&
    !message.parts.some((part) => part.type === "data-curation") &&
    last?.kind !== "text" &&
    !(last?.kind === "shell" && !last.done);
  const text = items
    .flatMap((item) => (item.kind === "text" ? [item.text] : []))
    .join("\n\n");

  return (
    <div className="flex w-full flex-col gap-3">
      {items.map((item) => (
        <TimelineItem key={item.key} item={item} />
      ))}
      {thinking ? <StatusMarker label="Thinking" /> : null}
      {streaming ? null : (
        <div className="-ml-1.5 flex">
          {text ? <CopyButton text={text} /> : null}
          <DebugDialog message={message} />
        </div>
      )}
    </div>
  );
}
