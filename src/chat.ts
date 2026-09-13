import { chatAgent } from "./agent";
import { memoryStore } from "./memory";

export type ChatSession = {
  sessionId: string;
  userId: string;
};

export class Chat {
  constructor(private session: ChatSession) {}

  getSession() {
    return this.session;
  }

  setSession(session: ChatSession) {
    this.session = session;
  }

  async clear() {
    await memoryStore.clear({ scope: this.session });
    console.log("History cleared.\n");
  }

  async send(message: string) {
    const stream = chatAgent.stream({
      prompt: message,
      session: this.session,
    });

    for await (const event of stream) {
      switch (event.type) {
        case "tool_call":
          console.log(`\n[tool] ${event.toolCall.toolName}`);
          break;
        case "tool_result":
          console.log(`[result]`, event.result);
          break;
        case "text_delta":
          process.stdout.write(event.delta);
          break;
        case "response":
          process.stdout.write("\n");
          break;
        case "interaction":
          process.stdout.write("\n");
          console.log("Interaction required:", event.interaction);
          break;
        case "blocked":
          process.stdout.write("\n");
          console.log(`Blocked at ${event.stage}: ${event.reason}`);
          break;
        case "error":
          process.stdout.write("\n");
          throw event.error ?? new Error("Agent stream error");
      }
    }

    console.log();
  }
}
