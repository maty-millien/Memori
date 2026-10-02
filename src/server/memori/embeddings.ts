import { z } from "zod";

import { SETTINGS, openrouterApiKey } from "./config";

const embeddingsResponse = z.object({
  data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()) })),
});

export async function embed(texts: string[]) {
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: SETTINGS.embeddingModel, input: texts }),
  });
  if (!response.ok) {
    throw new Error(
      `OpenRouter embeddings failed: ${response.status} ${await response.text()}`,
    );
  }
  const body = embeddingsResponse.parse(await response.json());
  return body.data
    .toSorted((a, b) => a.index - b.index)
    .map((item) => Float32Array.from(item.embedding));
}

export async function embedOne(text: string) {
  const [embedding] = await embed([text]);
  if (!embedding) {
    throw new Error("OpenRouter returned no embedding");
  }
  return embedding;
}
