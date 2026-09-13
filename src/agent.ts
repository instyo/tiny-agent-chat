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
    "Use get_memory_usage for app/process/host/container memory details; prefer it over shell for memory questions.",
    "Use run_command only for allowlisted inspection commands (free, ps, df, uname, etc.); never invent command output.",
    "Use web_search to find sources on the public internet; use web_fetch to read a specific URL as plain text.",
    "For web questions: search and/or fetch before answering; cite URLs; do not invent page contents.",
  ].join("\n"),
  maxTurns: 8,
  tools: chatTools,
  memory: {
    store: memoryStore,
    savePolicy: "turn",
  },
});
