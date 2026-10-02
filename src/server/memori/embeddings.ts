import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";

import { SETTINGS, openrouterApiKey } from "./config";

export async function embedOne(text: string) {
  const openrouter = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: openrouterApiKey(),
  });
  const { embedding } = await embed({
    model: openrouter.embedding(SETTINGS.embeddingModel),
    value: text,
  });
  return Float32Array.from(embedding);
}
