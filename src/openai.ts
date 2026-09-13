import { OpenAIClient } from "@anvia/openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required");
}

export const openai = new OpenAIClient({
  apiKey,
  baseUrl: process.env.OPENAI_BASE_URL,
});

export const model = openai.completionModel({
  modelId: "gpt-5.6-luna",
  api: "chat",
});

export function getModel(modelId: string) {
  return openai.completionModel({
    modelId,
    api: "chat",
  });
}
