import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SqliteMemoryClient } from "@anvia/memory-sqlite";

export const MEMORY_PATH =
  process.env.ANVIA_MEMORY_PATH ?? "data/anvia-memory.sqlite";

const client = new SqliteMemoryClient({
  path: MEMORY_PATH,
});

export const memoryStore = client.memoryStore();

export async function initMemory() {
  mkdirSync(dirname(MEMORY_PATH), { recursive: true });
  await memoryStore.ensure();
}
