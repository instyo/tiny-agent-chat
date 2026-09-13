import { createTool } from "@anvia/core";
import { isIP } from "node:net";
import { z } from "zod";

const DEFAULT_MAX_CHARS = 40_000;
const MAX_CHARS_CAP = 100_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 2_000_000;

function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // ULA
    if (normalized.startsWith("fe80")) return true; // link-local
    if (normalized.startsWith("::ffff:")) {
      const v4 = normalized.slice("::ffff:".length);
      if (isIP(v4) === 4) return isPrivateIp(v4);
    }
    return false;
  }
  return false;
}

function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "metadata.google.internal"
  ) {
    throw new Error("Fetching private/local hosts is not allowed.");
  }

  if (isIP(host) && isPrivateIp(host)) {
    throw new Error("Fetching private/link-local IP addresses is not allowed.");
  }

  return url;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, num) =>
      String.fromCodePoint(Number.parseInt(num, 10)),
    );
}

function htmlToText(html: string): { title: string; content: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, " ")).trim() : "";

  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const mainMatch =
    body.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ??
    body.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ??
    body.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (mainMatch) body = mainMatch[1];

  body = body
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ");

  const content = decodeHtmlEntities(body)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return { title, content };
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      throw new Error(`Response too large (>${MAX_BYTES} bytes).`);
    }
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new Error(`Response too large (>${MAX_BYTES} bytes).`);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function fetchWithRedirects(startUrl: URL): Promise<{
  response: Response;
  finalUrl: string;
  body: Uint8Array;
}> {
  let current = startUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    assertPublicUrl(current.toString());

    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent":
          "tiny-agent-chat/1.0 (+https://github.com/instyo/tiny-agent-chat)",
        accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`Redirect without Location header (${response.status}).`);
      }
      current = new URL(location, current);
      continue;
    }

    const body = await readLimitedBody(response);
    return { response, finalUrl: current.toString(), body };
  }

  throw new Error(`Too many redirects (>${MAX_REDIRECTS}).`);
}

export const webFetchTool = createTool({
  name: "web_fetch",
  description:
    "Fetch a public http(s) URL and return readable plain text (HTML stripped). Use after web_search to read a page. Blocks private/localhost addresses.",
  inputSchema: z.object({
    url: z.string().url().describe("Public http(s) URL to fetch"),
    maxChars: z
      .number()
      .int()
      .min(1000)
      .max(MAX_CHARS_CAP)
      .optional()
      .describe(`Max characters of text to return (default ${DEFAULT_MAX_CHARS})`),
  }),
  outputSchema: z.object({
    url: z.string(),
    finalUrl: z.string(),
    status: z.number(),
    contentType: z.string(),
    title: z.string().nullable(),
    content: z.string(),
    truncated: z.boolean(),
  }),
  async execute({ url, maxChars = DEFAULT_MAX_CHARS }) {
    const start = assertPublicUrl(url);
    const { response, finalUrl, body } = await fetchWithRedirects(start);
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
    const encoding = charsetMatch?.[1]?.replace(/["']/g, "") || "utf-8";

    let text: string;
    try {
      text = new TextDecoder(encoding, { fatal: false }).decode(body);
    } catch {
      text = new TextDecoder("utf-8", { fatal: false }).decode(body);
    }

    const isHtml =
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml") ||
      /^\s*<(!doctype html|html|head|body)\b/i.test(text);

    const isText =
      isHtml ||
      contentType.startsWith("text/") ||
      contentType.includes("application/json") ||
      contentType.includes("application/xml") ||
      contentType.includes("application/javascript") ||
      contentType === "" ||
      contentType.includes("application/xhtml");

    if (!isText) {
      throw new Error(
        `Unsupported content-type for text scrape: ${contentType || "unknown"}`,
      );
    }

    let title: string | null = null;
    let content: string;

    if (isHtml) {
      const extracted = htmlToText(text);
      title = extracted.title || null;
      content = extracted.content;
    } else if (contentType.includes("application/json")) {
      try {
        content = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        content = text;
      }
    } else {
      content = text.trim();
    }

    const cap = Math.min(Math.max(maxChars, 1000), MAX_CHARS_CAP);
    const truncated = content.length > cap;
    if (truncated) {
      content = `${content.slice(0, cap)}\n…[truncated]`;
    }

    return {
      url,
      finalUrl,
      status: response.status,
      contentType: contentType || "unknown",
      title,
      content,
      truncated,
    };
  },
});
