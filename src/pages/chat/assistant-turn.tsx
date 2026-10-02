import { Markdown } from "@/shared/components/markdown";
import { Bubble, BubbleContent } from "@/shared/components/ui/bubble";
import type { MemoriUIMessage } from "@/shared/lib/memori";

import { CopyButton } from "./copy-button";
import { DebugDialog } from "./debug-dialog";
import { StatusMarker } from "./trace-marker";

function status(message: MemoriUIMessage) {
  const types = new Set(message.parts.map((part) => part.type));
  if (!types.has("data-retrieval")) {
    return "Retrieving memories";
  }
  if (types.has("data-curation")) {
    return "Curating memories";
  }
  return types.has("text") ? null : "Thinking";
}

export function AssistantTurn({
  message,
  streaming,
}: {
  message: MemoriUIMessage;
  streaming: boolean;
}) {
  const label =
    streaming && !message.parts.some((part) => part.type === "data-usage")
      ? status(message)
      : null;
  const text = message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");

  return (
    <div className="flex w-full flex-col gap-3">
      {text ? (
        <Bubble variant="ghost">
          <BubbleContent>
            <Markdown>{text}</Markdown>
          </BubbleContent>
        </Bubble>
      ) : null}
      {label ? <StatusMarker label={label} /> : null}
      <div className="-ml-1.5 flex">
        {text ? <CopyButton text={text} /> : null}
        <DebugDialog message={message} />
      </div>
    </div>
  );
}
