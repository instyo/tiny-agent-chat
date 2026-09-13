import { calculateTool } from "./calculate";
import { getMemoryUsageTool } from "./get-memory-usage";
import { getTimeTool } from "./get-time";
import { runCommandTool } from "./run-command";
import { webFetchTool } from "./web-fetch";
import { webSearchTool } from "./web-search";

export const chatTools = [
  getTimeTool,
  calculateTool,
  getMemoryUsageTool,
  runCommandTool,
  webSearchTool,
  webFetchTool,
];

export {
  calculateTool,
  getMemoryUsageTool,
  getTimeTool,
  runCommandTool,
  webFetchTool,
  webSearchTool,
};
