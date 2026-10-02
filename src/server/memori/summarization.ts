import { Output, streamText } from "ai";
import { z } from "zod";

import { codexModel, codexProviderOptions } from "./codex";
import { SUMMARY_PROMPT } from "./prompts";

export async function summarize(conversation: string) {
  if (!conversation) {
    return "";
  }
  const result = streamText({
    model: codexModel,
    providerOptions: codexProviderOptions,
    system: SUMMARY_PROMPT,
    prompt: conversation,
    output: Output.object({ schema: z.object({ summary: z.string() }) }),
  });
  const { summary } = await result.output;
  return summary.trim();
}
