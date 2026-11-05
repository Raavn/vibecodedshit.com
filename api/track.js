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
  scroll_footer: `🔚 Reached the footer on ${PAGE}`,
  click_get_pack: `📦 Opened "Check how my app is doing" (Pack) on ${PAGE}`,
  click_emergency_open: `🚨 Clicked "I have an emergency" on ${PAGE}`,
  click_emergency_book: `🚨 Opened the emergency booking dialog on ${PAGE}`,
  click_book_call: `📞 Clicked the emergency call booking link on ${PAGE}`,
  get_pack_success: `✅ Requested the Pack on ${PAGE}`,
  leave_page: `🚪 Left ${PAGE}`,
};

const SOURCES = ["hero"];
// Matches the data-track-section names in index.html, in page order.
const SECTIONS = ["hero", "footer"];

/** @type {(value: unknown, min: number, max: number) => boolean} */
const isInt = (value, min, max) => Number.isInteger(value) && Number(value) >= min && Number(value) <= max;

/** @param {any} body */
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

/** @param {number} totalSeconds */
function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
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

/**
 * @param {{ method?: string, headers: Record<string, string | undefined>, body: unknown }} req
 * @param {{ setHeader: (name: string, value: string) => void, status: (code: number) => { json: (body: unknown) => unknown } }} res
 */
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
  let message = MESSAGES[/** @type {keyof typeof MESSAGES} */ (event)];
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
