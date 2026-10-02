import { IconArrowUp } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";

import { ContextRing } from "./context-ring";

export function Composer({
  busy,
  contextTokens,
  onSend,
}: {
  busy: boolean;
  contextTokens: number;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const text = value.trim();
    if (!text || busy) {
      return;
    }
    onSend(text);
    setValue("");
  }

  return (
    <form
      className="cursor-text rounded-3xl border border-input bg-popover pt-1 shadow-xs backdrop-blur-xl"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
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
      <div className="mt-3 flex w-full items-center justify-between p-2">
        <ContextRing tokens={contextTokens} />
        <Button
          type="submit"
          className="size-9 rounded-full"
          disabled={busy || !value.trim()}
        >
          {busy ? <Spinner /> : <IconArrowUp className="size-4" />}
          <span className="sr-only">Send</span>
        </Button>
      </div>
    </form>
  );
}
