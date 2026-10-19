import { IconArrowUp, IconPlayerStopFilled } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import type { ChatModel, ChatSettings } from "@/shared/lib/remanence";
import { Button } from "@/shared/ui/button";

import { ContextRing } from "./context-ring";
import { ModelMenu } from "./model-menu";

export function Composer({
  busy,
  contextTokens,
  models,
  chatSettings,
  onChatSettingsChange,
  onSend,
  onStop,
}: {
  busy: boolean;
  contextTokens: number;
  models: ChatModel[];
  chatSettings: ChatSettings;
  onChatSettingsChange: (settings: ChatSettings) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const empty = !value.trim();

  useEffect(() => {
    const element = form.current;
    const controller = new AbortController();
    function click(event: MouseEvent) {
      if (
        event.target instanceof Element &&
        !event.target.closest("button, a, input, textarea")
      ) {
        textarea.current?.focus();
      }
    }
    element?.addEventListener("click", click, controller);
    return () => controller.abort();
  }, []);

  function submit() {
    if (empty) {
      return;
    }
    onSend(value.trim());
    setValue("");
  }

  return (
    <form
      ref={form}
      className="cursor-text rounded-3xl border border-input bg-popover pt-1 shadow-xs backdrop-blur-xl"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={textarea}
        rows={1}
        value={value}
        placeholder="Ask Remanence"
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
          <ModelMenu
            models={models}
            settings={chatSettings}
            onChange={onChatSettingsChange}
          />
        </div>
        <div className="flex items-center gap-2">
          <ContextRing tokens={contextTokens} />
          {busy && empty ? (
            <Button type="button" className="size-9 rounded-full" onClick={onStop}>
              <IconPlayerStopFilled className="size-4" />
              <span className="sr-only">Stop</span>
            </Button>
          ) : (
            <Button type="submit" className="size-9 rounded-full" disabled={empty}>
              <IconArrowUp className="size-4" />
              <span className="sr-only">Send</span>
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
