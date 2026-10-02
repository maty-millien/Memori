import { z } from "zod";

import { SETTINGS, openrouterApiKey } from "./config";

const response = z.object({
  data: z.tuple([z.object({ embedding: z.array(z.number()) })]),
});

export async function embedOne(text: string) {
  const result = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: SETTINGS.embeddingModel, input: text }),
  });
  if (!result.ok) {
    throw new Error(`Embedding failed: ${result.status} ${await result.text()}`);
  }
  return Float32Array.from(response.parse(await result.json()).data[0].embedding);
}
