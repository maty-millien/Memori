import {
  IconArrowUp,
  IconFileTypePdf,
  IconPaperclip,
  IconPhoto,
  IconX,
} from "@tabler/icons-react";
import { useRef, useState } from "react";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { ATTACHMENT_TYPES, type ChatSettings } from "@/shared/lib/memori";

import { ContextRing } from "./context-ring";
import { ModelMenu } from "./model-menu";

export function Composer({
  busy,
  contextTokens,
  chatSettings,
  onChatSettingsChange,
  onSend,
}: {
  busy: boolean;
  contextTokens: number;
  chatSettings: ChatSettings;
  onChatSettingsChange: (settings: ChatSettings) => void;
  onSend: (text: string, files: File[]) => void;
}) {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const empty = !value.trim() && files.length === 0;

  function submit() {
    if (empty || busy) {
      return;
    }
    onSend(value.trim(), files);
    setValue("");
    setFiles([]);
  }

  return (
    <form
      className="cursor-text rounded-3xl border border-input bg-popover pt-1 shadow-xs backdrop-blur-xl"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-3 pt-2">
          {files.map((file, index) => (
            <div
              key={`${file.name}-${file.lastModified}-${file.size}`}
              className="flex items-center gap-1.5 rounded-full bg-accent py-1 pr-1 pl-3 text-sm"
            >
              {file.type === "application/pdf" ? (
                <IconFileTypePdf className="size-4" />
              ) : (
                <IconPhoto className="size-4" />
              )}
              <span className="max-w-40 truncate">{file.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-full"
                onClick={() => setFiles(files.filter((_, other) => other !== index))}
              >
                <IconX />
                <span className="sr-only">Remove {file.name}</span>
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <textarea
        rows={1}
        value={value}
        placeholder="Ask Memori"
        className="field-sizing-content max-h-50 min-h-11 w-full resize-none bg-transparent px-4 pt-3 text-base leading-[1.3] text-primary outline-none placeholder:text-muted-foreground"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="mt-3 flex w-full items-center justify-between gap-2 p-2">
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept={ATTACHMENT_TYPES.join(",")}
            onChange={(event) => {
              setFiles([...files, ...Array.from(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="rounded-full"
            onClick={() => fileInput.current?.click()}
          >
            <IconPaperclip />
            <span className="sr-only">Attach files</span>
          </Button>
          <ModelMenu settings={chatSettings} onChange={onChatSettingsChange} />
        </div>
        <div className="flex items-center gap-2">
          <ContextRing tokens={contextTokens} />
          <Button type="submit" className="size-9 rounded-full" disabled={busy || empty}>
            {busy ? <Spinner /> : <IconArrowUp className="size-4" />}
            <span className="sr-only">Send</span>
          </Button>
        </div>
      </div>
    </form>
  );
}
