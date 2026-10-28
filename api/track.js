// Vercel function: turns a page event into a Telegram ping.
// Ported from theloop.ai-operator.dev's /api/track. This page never holds a
// bot token; it POSTs the message to X's notify endpoint with AIMEKO_TOKEN.

const DEFAULT_NOTIFY_BASE_URL = "https://x.aimeko.com";
const PAGE = "vibecodedshit.com";

// Vendored from theloop/src/lib/bot-detection.ts: keeps crawlers and
// link-preview bots from firing the ping.
const BOT_USER_AGENT_REGEX =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|discordbot|linkedinbot|embedly|quora link preview|pinterest|vkshare|w3c_validator|headlesschrome|phantomjs|puppeteer|playwright|lighthouse|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot/i;

const MESSAGES = {
  view_page: `👀 Someone landed on ${PAGE}`,
  scroll_below_fold: `⬇️ Scrolled below the fold on ${PAGE}`,
  stay_5s: `⏱️ Stayed 5s+ on ${PAGE}`,
  stay_15s: `⏱️ Stayed 15s+ on ${PAGE}`,
  stay_30s: `⏱️ Stayed 30s+ on ${PAGE}`,
  scroll_average: `📊 Scrolled to the live average on ${PAGE}`,
  scroll_measures: `📏 Scrolled to "What it measures" on ${PAGE}`,
  scroll_bands: `🎚️ Scrolled to "Four bands" on ${PAGE}`,
  scroll_run: `▶️ Scrolled to "Run it" on ${PAGE}`,
  scroll_footer: `🔚 Reached the footer on ${PAGE}`,
  click_run: `▶️ Clicked "Run it" on ${PAGE}`,
  click_copy: `📋 Copied an install command on ${PAGE}`,
  click_subscribe: `📬 Opened "Get benchmark updates" on ${PAGE}`,
  subscribe_success: `✅ Joined the list on ${PAGE}`,
  click_methodology: `📄 Opened the methodology on ${PAGE}`,
  leave_page: `🚪 Left ${PAGE}`,
};

const SOURCES = ["hero", "nav", "measures", "marketplace", "install", "run"];
// Matches the data-track-section names in index.html, in page order.
const SECTIONS = ["hero", "average", "measures", "bands", "run", "footer"];

const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

function parse(body) {
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== "object") return null;

  const { event, visitorId, source, scrollDepth, secondsOnPage, furthestSection } = body;
  if (!Object.hasOwn(MESSAGES, event)) return null;
  if (visitorId !== undefined && (typeof visitorId !== "string" || visitorId.length < 1 || visitorId.length > 64)) return null;
  if (source !== undefined && !SOURCES.includes(source)) return null;
  if (scrollDepth !== undefined && !isInt(scrollDepth, 0, 100)) return null;
  if (secondsOnPage !== undefined && !isInt(secondsOnPage, 0, 86400)) return null;
  if (furthestSection !== undefined && !SECTIONS.includes(furthestSection)) return null;

  return { event, visitorId, source, scrollDepth, secondsOnPage, furthestSection };
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userAgent = req.headers["user-agent"] || "";
  if (BOT_USER_AGENT_REGEX.test(userAgent)) {
    return res.status(200).json({ success: true, skipped: "bot" });
  }

  const payload = parse(req.body);
  if (!payload) {
    return res.status(422).json({ error: "Invalid payload" });
  }

  const { event, visitorId, source, scrollDepth, secondsOnPage, furthestSection } = payload;
  let message = MESSAGES[event];
  if (source) message += `\nSource: ${source}`;
  if (scrollDepth !== undefined) message += `\nScroll depth: ${scrollDepth}%`;
  if (furthestSection) message += `\nFurthest section: ${furthestSection}`;
  if (secondsOnPage !== undefined) message += `\nTime on page: ${formatDuration(secondsOnPage)}`;
  if (visitorId) message += `\nVisitor: ${visitorId}`;
  if (userAgent) message += `\nBrowser: ${userAgent.slice(0, 200)}`;

  try {
    await sendNotification(message);
  } catch (error) {
    console.error("Failed to send notification:", error);
  }

  return res.status(200).json({ success: true });
};
