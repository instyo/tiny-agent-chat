import { calculateTool } from "./calculate";
import { getMemoryUsageTool } from "./get-memory-usage";
import { getTimeTool } from "./get-time";
import { runCommandTool } from "./run-command";

export const chatTools = [
  getTimeTool,
  calculateTool,
  getMemoryUsageTool,
  runCommandTool,
];

export {
  calculateTool,
  getMemoryUsageTool,
  getTimeTool,
  runCommandTool,
};
