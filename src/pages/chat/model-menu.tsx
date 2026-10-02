import { IconChevronDown } from "@tabler/icons-react";

import { OpenAILogo } from "@/shared/components/openai-logo";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  CHAT_MODEL_IDS,
  CHAT_MODELS,
  EFFORT_LABELS,
  REASONING_EFFORTS,
  type ChatModel,
  type ChatSettings,
  type ReasoningEffort,
} from "@/shared/lib/memori";

export function ModelMenu({
  settings,
  onChange,
}: {
  settings: ChatSettings;
  onChange: (settings: ChatSettings) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" className="h-9 rounded-full px-3" />
        }
      >
        <OpenAILogo />
        {CHAT_MODELS[settings.model]}
        <span className="text-muted-foreground">{EFFORT_LABELS[settings.effort]}</span>
        <IconChevronDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Model</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={settings.model}
            onValueChange={(model: ChatModel) =>
              onChange({ model, effort: settings.effort })
            }
          >
            {CHAT_MODEL_IDS.map((id) => (
              <DropdownMenuRadioItem key={id} value={id}>
                {CHAT_MODELS[id]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={settings.effort}
            onValueChange={(effort: ReasoningEffort) =>
              onChange({ model: settings.model, effort })
            }
          >
            {REASONING_EFFORTS.map((effort) => (
              <DropdownMenuRadioItem key={effort} value={effort}>
                {EFFORT_LABELS[effort]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
