import { z } from "zod";

import { SETTINGS } from "./config";

function openrouterApiKey() {
  const value = process.env.OPENROUTER_API_KEY;
  if (!value) {
    throw new Error("OPENROUTER_API_KEY must be set");
  }
  return value;
}

const response = z.object({
  data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()) })),
});

export async function embed(texts: string[], inputType: "query" | "document") {
  const result = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: SETTINGS.embeddingModel,
      input: texts,
      dimensions: SETTINGS.embeddingDimensions,
      input_type: inputType,
    }),
  });
  if (!result.ok) {
    throw new Error(`Embedding failed: ${result.status} ${await result.text()}`);
  }
  return response
    .parse(await result.json())
    .data.toSorted((a, b) => a.index - b.index)
    .map((item) => Float32Array.from(item.embedding));
}

export async function embedOne(text: string, inputType: "query" | "document") {
  const [embedding] = await embed([text], inputType);
  return embedding;
}
