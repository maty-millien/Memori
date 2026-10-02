import { IconArrowUp } from "@tabler/icons-react";
import { useState } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from "@/shared/components/ui/input-group";
import { Spinner } from "@/shared/components/ui/spinner";
import { formatNumber } from "@/shared/lib/format";
import { CONTEXT_WINDOW } from "@/shared/lib/memori";

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
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          value={value}
          placeholder="Message Memori"
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
        <InputGroupAddon align="block-end">
          <InputGroupText>
            {Math.round((contextTokens / CONTEXT_WINDOW) * 100)}% context,{" "}
            {formatNumber(contextTokens)} / {formatNumber(CONTEXT_WINDOW)} tokens
          </InputGroupText>
          <InputGroupButton
            type="submit"
            variant="default"
            size="icon-sm"
            className="ml-auto"
            disabled={busy || !value.trim()}
          >
            {busy ? <Spinner /> : <IconArrowUp />}
            <span className="sr-only">Send</span>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
