import { createTool } from "@anvia/core";
import { z } from "zod";

type SearchHit = { title: string; url: string; snippet: string };
type SearchProvider = "tavily" | "duckduckgo" | "bing";

const resultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

const UA =
  "Mozilla/5.0 (compatible; tiny-agent-chat/1.0; +https://github.com/instyo/tiny-agent-chat)";

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

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapDdgRedirect(href: string): string {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    if (url.hostname.includes("duckduckgo.com") && url.pathname === "/l/") {
      const uddg = url.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    }
    return url.toString();
  } catch {
    return href;
  }
}

function unwrapBingRedirect(href: string): string {
  try {
    const url = new URL(href, "https://www.bing.com");
    if (url.hostname.includes("bing.com") && url.pathname === "/ck/a") {
      const u = url.searchParams.get("u");
      if (u) {
        // Bing often prefixes with "a1" then base64url
        const raw = u.startsWith("a1") ? u.slice(2) : u;
        try {
          const decoded = Buffer.from(
            raw.replace(/-/g, "+").replace(/_/g, "/"),
            "base64",
          ).toString("utf8");
          if (decoded.startsWith("http")) return decoded;
        } catch {
          // fall through
        }
      }
    }
    return url.toString();
  } catch {
    return href;
  }
}

async function searchTavily(query: string, limit: number) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: limit,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Tavily search failed (${response.status}): ${body.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  const results = (data.results ?? [])
    .map((item) => ({
      title: (item.title ?? "").trim() || item.url || "Untitled",
      url: item.url ?? "",
      snippet: (item.content ?? "").trim(),
    }))
    .filter((item) => item.url)
    .slice(0, limit);

  return { provider: "tavily" as const, results };
}

async function searchDuckDuckGo(query: string, limit: number) {
  const endpoints = [
    "https://html.duckduckgo.com/html/",
    "https://duckduckgo.com/html/",
  ];

  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set("q", query);

      const response = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html" },
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      });

      if (!response.ok) {
        throw new Error(`DuckDuckGo search failed (${response.status})`);
      }

      const html = await response.text();
      const results: SearchHit[] = [];

      const blockRe =
        /<div class="result[^"]*"[^>]*>[\s\S]*?<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div class="result__snippet"[^>]*>([\s\S]*?)<\/div>)?/gi;

      let match: RegExpExecArray | null;
      while ((match = blockRe.exec(html)) != null && results.length < limit) {
        const href = unwrapDdgRedirect(decodeHtmlEntities(match[1] ?? ""));
        const title = stripTags(match[2] ?? "");
        const snippet = stripTags(match[3] ?? match[4] ?? "");
        if (!href || !title) continue;
        if (
          href.includes("duckduckgo.com") &&
          !href.includes("uddg=") &&
          !/^https?:\/\/(?!duckduckgo\.com)/i.test(href)
        ) {
          continue;
        }
        results.push({ title, url: href, snippet });
      }

      if (results.length === 0) {
        const looseRe =
          /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        while ((match = looseRe.exec(html)) != null && results.length < limit) {
          const href = unwrapDdgRedirect(decodeHtmlEntities(match[1] ?? ""));
          const title = stripTags(match[2] ?? "");
          if (!href || !title) continue;
          results.push({ title, url: href, snippet: "" });
        }
      }

      if (results.length === 0) {
        throw new Error(
          "DuckDuckGo returned no parseable results (blocked or markup changed).",
        );
      }

      return { provider: "duckduckgo" as const, results };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("DuckDuckGo search failed.");
}

async function searchBing(query: string, limit: number) {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(limit + 2, 15)));

  const response = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html",
      "accept-language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Bing search failed (${response.status})`);
  }

  const html = await response.text();
  const results: SearchHit[] = [];
  const seen = new Set<string>();

  // Organic results: <li class="b_algo"> ... <h2><a href="...">title</a></h2> ... <p> or <div class="b_caption">
  const blockRe =
    /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>|<div class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>)?/gi;

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) != null && results.length < limit) {
    let href = unwrapBingRedirect(decodeHtmlEntities(match[1] ?? ""));
    const title = stripTags(match[2] ?? "");
    const snippet = stripTags(match[3] ?? match[4] ?? "");
    if (!href || !title) continue;
    if (!/^https?:\/\//i.test(href)) continue;
    if (href.includes("bing.com/") || href.includes("microsoft.com/")) {
      // keep microsoft docs; skip bing chrome/noise
      if (
        href.includes("bing.com/search") ||
        href.includes("bing.com/ck/") ||
        href.includes("go.microsoft.com")
      ) {
        // still try unwrap already done; skip pure bing UI
        if (href.includes("bing.com/")) continue;
      }
    }
    try {
      href = new URL(href).toString();
    } catch {
      continue;
    }
    if (seen.has(href)) continue;
    seen.add(href);
    results.push({ title, url: href, snippet });
  }

  if (results.length === 0) {
    throw new Error(
      "Bing returned no parseable results (blocked or markup changed).",
    );
  }

  return { provider: "bing" as const, results };
}

export const webSearchTool = createTool({
  name: "web_search",
  description:
    "Search the public web. Uses Tavily when TAVILY_API_KEY is set; otherwise DuckDuckGo, then Bing fallback. Returns titles, URLs, and snippets.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Search query"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe("Max results (default 5, max 10)"),
  }),
  outputSchema: z.object({
    provider: z.enum(["tavily", "duckduckgo", "bing"]),
    query: z.string(),
    results: z.array(resultSchema),
  }),
  async execute({ query, limit = 5 }) {
    const capped = Math.min(Math.max(limit, 1), 10);

    const tavily = await searchTavily(query, capped);
    if (tavily) {
      return { provider: tavily.provider, query, results: tavily.results };
    }

    const errors: string[] = [];

    try {
      const ddg = await searchDuckDuckGo(query, capped);
      return { provider: ddg.provider, query, results: ddg.results };
    } catch (error) {
      errors.push(
        `duckduckgo: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      const bing = await searchBing(query, capped);
      return { provider: bing.provider, query, results: bing.results };
    } catch (error) {
      errors.push(
        `bing: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    throw new Error(
      `web_search failed for all providers. ${errors.join(" | ")}`,
    );
  },
});
