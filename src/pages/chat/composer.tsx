import {
  IconArrowUp,
  IconFileTypePdf,
  IconPaperclip,
  IconPhoto,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";
import { ATTACHMENT_TYPES, type ChatModel, type ChatSettings } from "@/shared/lib/memori";
import { cn } from "@/shared/lib/utils";

import { ContextRing } from "./context-ring";
import { ModelMenu } from "./model-menu";

export function Composer({
  busy,
  contextTokens,
  models,
  chatSettings,
  onChatSettingsChange,
  onSend,
}: {
  busy: boolean;
  contextTokens: number;
  models: ChatModel[];
  chatSettings: ChatSettings;
  onChatSettingsChange: (settings: ChatSettings) => void;
  onSend: (text: string, files: File[]) => void;
}) {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const empty = !value.trim() && files.length === 0;
  const images = models.find((model) => model.id === chatSettings.model)?.images ?? false;
  const accepted = ATTACHMENT_TYPES.filter(
    (type) => images || !type.startsWith("image/"),
  ).join(",");

  useEffect(() => {
    const element = form.current;
    const controller = new AbortController();
    function over(event: DragEvent) {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        setDragging(true);
      }
    }
    function leave(event: DragEvent) {
      if (
        !(event.relatedTarget instanceof Node && element?.contains(event.relatedTarget))
      ) {
        setDragging(false);
      }
    }
    function drop(event: DragEvent) {
      event.preventDefault();
      setDragging(false);
      const dropped = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
        accepted.split(",").includes(file.type),
      );
      setFiles((current) => [...current, ...dropped]);
    }
    element?.addEventListener("dragover", over, controller);
    element?.addEventListener("dragleave", leave, controller);
    element?.addEventListener("drop", drop, controller);
    return () => controller.abort();
  }, [accepted]);

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
      ref={form}
      className={cn(
        "cursor-text rounded-3xl border border-input bg-popover pt-1 shadow-xs backdrop-blur-xl",
        dragging && "ring-2 ring-ring",
      )}
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
            accept={accepted}
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
          <ModelMenu
            models={models}
            settings={chatSettings}
            onChange={onChatSettingsChange}
          />
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
