import { createTool } from "@anvia/core";
import { execFile } from "node:child_process";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const ALLOWED_COMMANDS = new Set([
  "free",
  "ps",
  "top",
  "df",
  "du",
  "uname",
  "uptime",
  "vm_stat",
  "sysctl",
  "cat",
  "head",
  "tail",
  "wc",
  "env",
  "pwd",
  "ls",
  "id",
  "nproc",
]);

const PATH_SCOPED_COMMANDS = new Set(["cat", "head", "tail", "ls", "du"]);

const ALLOWED_READ_PREFIXES = [
  "/sys/fs/cgroup",
  "/proc/self",
  "/proc/meminfo",
  "/proc/cpuinfo",
  "/proc/loadavg",
  "/proc/uptime",
];

const TIMEOUT_MS = 8_000;
const MAX_OUTPUT_CHARS = 48_000;

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated]`,
    truncated: true,
  };
}

function isPathInside(parent: string, child: string): boolean {
  const rel = resolve(child).startsWith(resolve(parent) + sep) ||
    resolve(child) === resolve(parent);
  return rel;
}

function assertSafePathArg(command: string, arg: string) {
  if (arg.startsWith("-")) return;

  if (arg.includes("\0")) {
    throw new Error("Null bytes are not allowed in paths.");
  }

  const cwd = process.cwd();
  const absolute = resolve(cwd, arg);

  if (command === "ls" || command === "du") {
    if (!isPathInside(cwd, absolute) && absolute !== cwd) {
      const allowedRoot = ALLOWED_READ_PREFIXES.some(
        (prefix) => isPathInside(prefix, absolute) || absolute === prefix,
      );
      if (!allowedRoot) {
        throw new Error(
          `Path not allowed for ${command}: must be under cwd or system info paths.`,
        );
      }
    }
    return;
  }

  // cat / head / tail
  const allowed = ALLOWED_READ_PREFIXES.some(
    (prefix) => isPathInside(prefix, absolute) || absolute === prefix,
  );
  if (!allowed) {
    throw new Error(
      `Path not allowed for ${command}. Allowed prefixes: ${ALLOWED_READ_PREFIXES.join(", ")}`,
    );
  }
}

function validateArgs(command: string, args: string[]) {
  for (const arg of args) {
    if (/[;&|`$<>]/.test(arg)) {
      throw new Error(`Shell metacharacters are not allowed in args: ${arg}`);
    }
  }

  if (PATH_SCOPED_COMMANDS.has(command)) {
    const pathArgs = args.filter((a) => !a.startsWith("-"));
    if (command !== "ls" && command !== "du" && pathArgs.length === 0) {
      throw new Error(`${command} requires an allowlisted path argument.`);
    }
    for (const pathArg of pathArgs) {
      assertSafePathArg(command, pathArg);
    }
  }
}

export const runCommandTool = createTool({
  name: "run_command",
  description:
    "Run a restricted allowlisted system command for inspection (memory, processes, disk, uname). No shell, no pipes. Prefer get_memory_usage for app/container memory.",
  inputSchema: z.object({
    command: z
      .string()
      .min(1)
      .describe(
        "Allowlisted command basename only, e.g. free, ps, df, uname, cat",
      ),
    args: z
      .array(z.string())
      .optional()
      .describe("Arguments only (no shell syntax). Example: [\"-h\"] for free -h"),
  }),
  outputSchema: z.object({
    command: z.string(),
    args: z.array(z.string()),
    exitCode: z.number().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    timedOut: z.boolean(),
    durationMs: z.number(),
    truncated: z.boolean(),
  }),
  async execute({ command, args = [] }) {
    const basename = command.trim();
    if (basename.includes("/") || basename.includes("\\")) {
      throw new Error("Command must be a basename only (no path separators).");
    }
    if (!ALLOWED_COMMANDS.has(basename)) {
      throw new Error(
        `Command not allowed: ${basename}. Allowed: ${[...ALLOWED_COMMANDS].sort().join(", ")}`,
      );
    }

    validateArgs(basename, args);

    const started = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync(basename, args, {
        cwd: process.cwd(),
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_CHARS * 2,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
          HOME: process.env.HOME,
          LANG: process.env.LANG ?? "C.UTF-8",
          TERM: "dumb",
        },
        encoding: "utf8",
      });

      const out = truncate(stdout ?? "");
      const err = truncate(stderr ?? "");

      return {
        command: basename,
        args,
        exitCode: 0,
        stdout: out.text,
        stderr: err.text,
        timedOut: false,
        durationMs: Date.now() - started,
        truncated: out.truncated || err.truncated,
      };
    } catch (error) {
      const err = error as {
        code?: string;
        killed?: boolean;
        signal?: string;
        status?: number;
        stdout?: string;
        stderr?: string;
        message?: string;
      };

      const timedOut =
        err.killed === true ||
        err.code === "ETIMEDOUT" ||
        err.signal === "SIGTERM";

      const out = truncate(err.stdout ?? "");
      const errOut = truncate(
        err.stderr ?? (timedOut ? "Command timed out." : (err.message ?? "")),
      );

      return {
        command: basename,
        args,
        exitCode: typeof err.status === "number" ? err.status : null,
        stdout: out.text,
        stderr: errOut.text,
        timedOut,
        durationMs: Date.now() - started,
        truncated: out.truncated || errOut.truncated,
      };
    }
  },
});
