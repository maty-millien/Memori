import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

import { SETTINGS } from "./config";

const PREFIXES = {
  query: "task: search result | query: ",
  document: "title: none | text: ",
};

let extractor: Promise<FeatureExtractionPipeline> | undefined;

export async function embed(texts: string[], inputType: "query" | "document") {
  extractor ??= pipeline("feature-extraction", SETTINGS.embeddingModel, {
    dtype: "fp32",
    device: "cpu",
  });
  const model = await extractor;
  return Promise.all(
    texts.map(async (text) => {
      const output = await model(PREFIXES[inputType] + text, {
        pooling: "mean",
        normalize: true,
      });
      return Float32Array.from(output.tolist()[0]);
    }),
  );
}

export async function embedOne(text: string, inputType: "query" | "document") {
  const [embedding] = await embed([text], inputType);
  return embedding;
}
