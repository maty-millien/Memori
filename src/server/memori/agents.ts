import { Output, ToolLoopAgent, isStepCount } from "ai";
import { z } from "zod";

import { CHAT_MODEL_IDS, REASONING_EFFORTS } from "@/shared/lib/memori";

import {
  chatProviderOptions,
  codexChatModel,
  codexModel,
  codexProviderOptions,
} from "./codex";
import { memoryTools } from "./memory-tools";
import { CHAT_PROMPT, CURATION_PROMPT, SUMMARY_PROMPT } from "./prompts";

export const chatAgent = new ToolLoopAgent({
  model: codexModel,
  instructions: CHAT_PROMPT,
  callOptionsSchema: z.object({
    model: z.enum(CHAT_MODEL_IDS),
    effort: z.enum(REASONING_EFFORTS),
  }),
  prepareCall: ({ options, ...settings }) => ({
    ...settings,
    model: codexChatModel(options.model),
    providerOptions: chatProviderOptions(options.effort),
  }),
});

export const curationAgent = new ToolLoopAgent({
  model: codexModel,
  providerOptions: codexProviderOptions,
  instructions: CURATION_PROMPT,
  tools: memoryTools,
  stopWhen: isStepCount(5),
});

export const summaryAgent = new ToolLoopAgent({
  model: codexModel,
  providerOptions: codexProviderOptions,
  instructions: SUMMARY_PROMPT,
  output: Output.object({ schema: z.object({ summary: z.string() }) }),
});
