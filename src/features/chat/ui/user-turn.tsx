import { IconFileTypePdf } from "@tabler/icons-react";

import { messageText, type MemoriUIMessage } from "@/shared/lib/memori";
import { Bubble, BubbleContent } from "@/shared/ui/bubble";

export function UserTurn({ message }: { message: MemoriUIMessage }) {
  const text = messageText(message.parts);
  const files = message.parts.flatMap((part) => (part.type === "file" ? [part] : []));

  return (
    <div className="flex flex-col items-end gap-2">
      {files.length > 0 ? (
        <div className="flex max-w-[70%] flex-wrap justify-end gap-2">
          {files.map((file) =>
            file.mediaType.startsWith("image/") ? (
              <img
                key={file.url}
                src={file.url}
                alt={file.filename ?? "Attachment"}
                className="max-h-48 rounded-2xl border border-input"
              />
            ) : (
              <a
                key={file.url}
                href={file.url}
                target="_blank"
                rel="noreferrer"
                download={file.filename}
                className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm"
              >
                <IconFileTypePdf className="size-4" />
                {file.filename ?? "Attachment"}
              </a>
            ),
          )}
        </div>
      ) : null}
      {text.trim() ? (
        <Bubble variant="secondary" align="end" className="max-w-[70%]">
          <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
        </Bubble>
      ) : null}
    </div>
  );
}
