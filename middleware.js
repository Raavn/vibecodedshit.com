// Vercel Routing Middleware: pings Telegram when an AI agent or AI crawler
// requests a page. Client-side tracking (index.html -> api/track.js) never sees
// these visits because crawlers don't run JS, so this runs on the request.
// Ported from theloop/src/app/page.tsx. Zero npm packages: waitUntil comes from
// the middleware context. The request always continues to the static file.

const DEFAULT_NOTIFY_BASE_URL = "https://x.aimeko.com";
const SITE = "vibecodedshit.com";
const RATE_LIMIT_MS = 30 * 60 * 1000;

// Vendored from theloop/src/lib/bot-detection.ts. Generic crawlers (Googlebot,
// Ahrefs) and link previews are not pinged, only AI agents and AI crawlers.
const AI_AGENT_USER_AGENT_REGEX =
  /gptbot|chatgpt-user|oai-searchbot|claudebot|claude-user|claude-searchbot|anthropic-ai|perplexitybot|perplexity-user|google-extended|applebot-extended|bytespider|ccbot|meta-externalagent|meta-externalfetcher|cohere-ai|duckassistbot|youbot|amazonbot|diffbot|imagesiftbot|timpibot/i;

/** @type {Array<[string, RegExp]>} */
const KNOWN_UA_LABELS = [
  ["Google-Extended", /google-extended/i],
  ["GPTBot", /gptbot/i],
  ["ChatGPT-User", /chatgpt-user/i],
  ["OAI-SearchBot", /oai-searchbot/i],
  ["ClaudeBot", /claudebot/i],
  ["Claude-User", /claude-user/i],
  ["Claude-SearchBot", /claude-searchbot/i],
  ["Anthropic-AI", /anthropic-ai/i],
  ["PerplexityBot", /perplexitybot/i],
  ["Perplexity-User", /perplexity-user/i],
  ["Applebot-Extended", /applebot-extended/i],
  ["Bytespider", /bytespider/i],
  ["CCBot", /ccbot/i],
  ["Meta-ExternalAgent", /meta-externalagent/i],
  ["Meta-ExternalFetcher", /meta-externalfetcher/i],
  ["Cohere-AI", /cohere-ai/i],
  ["DuckAssistBot", /duckassistbot/i],
  ["YouBot", /youbot/i],
  ["Amazonbot", /amazonbot/i],
  ["Diffbot", /diffbot/i],
  ["ImagesiftBot", /imagesiftbot/i],
  ["Timpibot", /timpibot/i],
];

/** @param {string} userAgent */
function describeUserAgent(userAgent) {
  for (const [label, pattern] of KNOWN_UA_LABELS) {
    if (pattern.test(userAgent)) return label;
  }
  return userAgent.trim().split(/[\s/]/)[0] || "Unknown bot";
}

// One ping per agent label per 30 minutes. In memory and per instance, so a
// cold start can ping again (same as theloop's botVisitRateLimiter).
/** @type {Map<string, number>} */
const lastPingAt = new Map();

/** @param {string} label */
function rateLimited(label) {
  const now = Date.now();
  const last = lastPingAt.get(label);
  if (last !== undefined && now - last < RATE_LIMIT_MS) return true;
  lastPingAt.set(label, now);
  return false;
}

/** @param {string} message */
async function sendNotification(message) {
  const token = process.env.AIMEKO_TOKEN;
  if (!token) throw new Error("Missing AIMEKO_TOKEN");

  const baseUrl = process.env.X_BASE_URL || DEFAULT_NOTIFY_BASE_URL;
  const res = await fetch(`${baseUrl}/api/ai/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ai-token": token },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    throw new Error(`Notify API error (${res.status}): ${await res.text()}`);
  }
}

/** @param {string} userAgent @param {string} path */
async function notifyAgentVisit(userAgent, path) {
  const label = describeUserAgent(userAgent);
  const message = `🧠 AI agent visit on ${SITE}\nAgent: ${label}\nBrowser: ${userAgent.slice(0, 200)}\nPath: ${path}`;
  try {
    await sendNotification(message);
  } catch (error) {
    console.error("Failed to send notification:", error);
  }
}

/**
 * @param {Request} request
 * @param {{ waitUntil: (promise: Promise<unknown>) => void }} context
 */
export default function middleware(request, context) {
  const userAgent = request.headers.get("user-agent") || "";
  if (!AI_AGENT_USER_AGENT_REGEX.test(userAgent)) return;

  if (rateLimited(describeUserAgent(userAgent))) return;

  context.waitUntil(notifyAgentVisit(userAgent, new URL(request.url).pathname));
}

export const config = {
  matcher: ["/", "/faq/", "/methodology/", "/terms/", "/llms.txt", "/robots.txt", "/sitemap.xml"],
};
