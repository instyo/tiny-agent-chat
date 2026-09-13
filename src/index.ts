import { createInterface } from "node:readline";
import { Chat } from "./chat";
import { initMemory, MEMORY_PATH } from "./memory";

await initMemory();

const chat = new Chat({
  sessionId: process.env.CHAT_SESSION_ID ?? "default",
  userId: process.env.CHAT_USER_ID ?? "local",
});

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const session = chat.getSession();

console.log("Tiny Agent Chat");
console.log("Tools: get_time, calculate");
console.log(`Memory: ${MEMORY_PATH}`);
console.log(`Session: ${session.sessionId} (user: ${session.userId})`);
console.log("Commands: /exit  /clear  /session  /new\n");

function ask() {
  rl.question("You > ", async (input) => {
    if (input === "/exit") {
      rl.close();
      return;
    }

    if (input === "/clear") {
      try {
        await chat.clear();
      } catch (error) {
        console.error("\nError:", error);
      }
      ask();
      return;
    }

    if (input === "/session") {
      const current = chat.getSession();
      console.log(
        `Session: ${current.sessionId} (user: ${current.userId})\n`,
      );
      ask();
      return;
    }

    if (input === "/new") {
      const next = {
        sessionId: `session_${Date.now()}`,
        userId: chat.getSession().userId,
      };
      chat.setSession(next);
      console.log(`New session: ${next.sessionId}\n`);
      ask();
      return;
    }

    try {
      process.stdout.write("\nAI > ");
      await chat.send(input);
    } catch (error) {
      console.error("\nError:", error);
    }

    ask();
  });
}

ask();
