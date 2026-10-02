import { IconBrain, IconTerminal2, IconWorldSearch } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Markdown } from "@/shared/components/markdown";
import { Bubble, BubbleContent } from "@/shared/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/shared/components/ui/marker";
import { formatSeconds } from "@/shared/lib/format";
import type { MemoriUIMessage } from "@/shared/lib/memori";

import { CopyButton } from "./copy-button";
import { DebugDialog } from "./debug-dialog";
import { StatusMarker } from "./trace-marker";

type Part = MemoriUIMessage["parts"][number];

function Step({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Marker>
      <MarkerIcon>{icon}</MarkerIcon>
      <MarkerContent className="truncate">{children}</MarkerContent>
    </Marker>
  );
}

function TimelinePart({ part }: { part: Part }) {
  switch (part.type) {
    case "text":
      return (
        <Bubble variant="ghost">
          <BubbleContent>
            <Markdown>{part.text}</Markdown>
          </BubbleContent>
        </Bubble>
      );
    case "data-thought":
      return <Step icon={<IconBrain />}>Thought for {formatSeconds(part.data.ms)}</Step>;
    case "data-command":
      return part.data.running ? (
        <StatusMarker label={`Running ${part.data.command}`} />
      ) : (
        <Step icon={<IconTerminal2 />}>Ran {part.data.command}</Step>
      );
    case "data-search":
      return part.data.running ? (
        <StatusMarker label="Searching the web" />
      ) : (
        <Step icon={<IconWorldSearch />}>Searched {part.data.query}</Step>
      );
    default:
      return null;
  }
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
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");

  return (
    <div className="flex w-full flex-col gap-3">
      {[...message.parts.entries()].map(([index, part]) => (
        <TimelinePart key={`${part.type}-${index}`} part={part} />
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
