import { createTool } from "@anvia/core";
import { z } from "zod";

export const getTimeTool = createTool({
  name: "get_time",
  description: "Get the current date and time in ISO-8601 format.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    iso: z.string(),
  }),
  async execute() {
    return { iso: new Date().toISOString() };
  },
});
