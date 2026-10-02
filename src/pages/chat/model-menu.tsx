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
import { effortLabel, type ChatModel, type ChatSettings } from "@/shared/lib/memori";

export function ModelMenu({
  models,
  settings,
  onChange,
}: {
  models: ChatModel[];
  settings: ChatSettings;
  onChange: (settings: ChatSettings) => void;
}) {
  const current = models.find((model) => model.id === settings.model);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" className="h-9 rounded-full px-3" />
        }
      >
        <OpenAILogo />
        {current?.name ?? settings.model}
        <span className="text-muted-foreground">{effortLabel(settings.effort)}</span>
        <IconChevronDown className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Model</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={settings.model}
            onValueChange={(id: string) => {
              const model = models.find((item) => item.id === id);
              if (model) {
                onChange({
                  model: id,
                  effort: model.efforts.includes(settings.effort)
                    ? settings.effort
                    : model.defaultEffort,
                });
              }
            }}
          >
            {models.map((model) => (
              <DropdownMenuRadioItem key={model.id} value={model.id}>
                {model.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={settings.effort}
            onValueChange={(effort: string) =>
              onChange({ model: settings.model, effort })
            }
          >
            {current?.efforts.map((effort) => (
              <DropdownMenuRadioItem key={effort} value={effort}>
                {effortLabel(effort)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
