import { Agent } from "@anvia/core";
import { model } from "./openai";
import { memoryStore } from "./memory";
import { chatTools } from "./tools";

export const chatAgent = new Agent({
  id: "tiny-chat",
  model,
  instructions: [
    "You are a helpful CLI assistant.",
    "Use conversation history when it is relevant.",
    "Use get_time when the user asks about the current date or time.",
    "Use calculate for arithmetic; do not guess math results.",
  ].join("\n"),
  maxTurns: 4,
  tools: chatTools,
  memory: {
    store: memoryStore,
    savePolicy: "turn",
  },
});
