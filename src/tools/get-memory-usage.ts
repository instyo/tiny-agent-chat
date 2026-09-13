import { createTool } from "@anvia/core";
import { freemem, loadavg, totalmem } from "node:os";
import { readFile } from "node:fs/promises";
import { z } from "zod";

function bytesToMb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function formatMem(bytes: number) {
  return { bytes, mb: bytesToMb(bytes) };
}

async function readText(path: string): Promise<string | null> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    return null;
  }
}

function parseCgroupBytes(raw: string | null): number | null {
  if (raw == null || raw === "" || raw === "max") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  // cgroup v1 often uses a huge sentinel (~2^63-1) for "unlimited"
  if (n >= Number.MAX_SAFE_INTEGER || n > 1e15) return null;
  return n;
}

async function readCgroupMemory() {
  const v2Current = await readText("/sys/fs/cgroup/memory.current");
  if (v2Current != null) {
    const current = parseCgroupBytes(v2Current);
    const max = parseCgroupBytes(await readText("/sys/fs/cgroup/memory.max"));
    const peak = parseCgroupBytes(await readText("/sys/fs/cgroup/memory.peak"));
    const swapCurrent = parseCgroupBytes(
      await readText("/sys/fs/cgroup/memory.swap.current"),
    );
    const usagePercent =
      current != null && max != null && max > 0
        ? Math.round((current / max) * 10000) / 100
        : null;

    return {
      version: "v2" as const,
      current: current != null ? formatMem(current) : null,
      max: max != null ? formatMem(max) : null,
      peak: peak != null ? formatMem(peak) : null,
      swapCurrent: swapCurrent != null ? formatMem(swapCurrent) : null,
      usagePercent,
      note: null as string | null,
    };
  }

  const v1Usage = await readText(
    "/sys/fs/cgroup/memory/memory.usage_in_bytes",
  );
  if (v1Usage != null) {
    const current = parseCgroupBytes(v1Usage);
    const max = parseCgroupBytes(
      await readText("/sys/fs/cgroup/memory/memory.limit_in_bytes"),
    );
    const peak = parseCgroupBytes(
      await readText("/sys/fs/cgroup/memory/memory.max_usage_in_bytes"),
    );
    const usagePercent =
      current != null && max != null && max > 0
        ? Math.round((current / max) * 10000) / 100
        : null;

    return {
      version: "v1" as const,
      current: current != null ? formatMem(current) : null,
      max: max != null ? formatMem(max) : null,
      peak: peak != null ? formatMem(peak) : null,
      swapCurrent: null,
      usagePercent,
      note: null as string | null,
    };
  }

  return {
    version: null,
    current: null,
    max: null,
    peak: null,
    swapCurrent: null,
    usagePercent: null,
    note: "No cgroup memory files found (typical on macOS/host outside Docker).",
  };
}

const memSizeSchema = z.object({
  bytes: z.number(),
  mb: z.number(),
});

export const getMemoryUsageTool = createTool({
  name: "get_memory_usage",
  description:
    "Get detailed memory usage for this app process, the host OS, and container/cgroup limits when available (Docker/Linux).",
  inputSchema: z.object({
    unit: z
      .enum(["bytes", "mb"])
      .optional()
      .describe("Preferred display unit hint for the model (default: mb)."),
  }),
  outputSchema: z.object({
    unitHint: z.enum(["bytes", "mb"]),
    process: z.object({
      pid: z.number(),
      uptimeSec: z.number(),
      platform: z.string(),
      arch: z.string(),
      runtime: z.string(),
      rss: memSizeSchema,
      heapTotal: memSizeSchema,
      heapUsed: memSizeSchema,
      external: memSizeSchema,
      arrayBuffers: memSizeSchema,
    }),
    host: z.object({
      total: memSizeSchema,
      free: memSizeSchema,
      used: memSizeSchema,
      loadavg: z.array(z.number()),
    }),
    cgroup: z.object({
      version: z.enum(["v1", "v2"]).nullable(),
      current: memSizeSchema.nullable(),
      max: memSizeSchema.nullable(),
      peak: memSizeSchema.nullable(),
      swapCurrent: memSizeSchema.nullable(),
      usagePercent: z.number().nullable(),
      note: z.string().nullable(),
    }),
  }),
  async execute({ unit }) {
    const mu = process.memoryUsage();
    const total = totalmem();
    const free = freemem();
    const cgroup = await readCgroupMemory();

    const runtime =
      typeof Bun !== "undefined"
        ? `bun/${Bun.version}`
        : `node/${process.version}`;

    return {
      unitHint: unit ?? "mb",
      process: {
        pid: process.pid,
        uptimeSec: Math.round(process.uptime() * 100) / 100,
        platform: process.platform,
        arch: process.arch,
        runtime,
        rss: formatMem(mu.rss),
        heapTotal: formatMem(mu.heapTotal),
        heapUsed: formatMem(mu.heapUsed),
        external: formatMem(mu.external),
        arrayBuffers: formatMem(mu.arrayBuffers),
      },
      host: {
        total: formatMem(total),
        free: formatMem(free),
        used: formatMem(total - free),
        loadavg: loadavg(),
      },
      cgroup,
    };
  },
});
