import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { initWasm, Resvg, type ResvgRenderOptions } from '@resvg/resvg-wasm';
import { packageRoot } from '../methodology/load.js';
import { escapeHtml as e } from '../report/escape.js';

interface CardSide {
  score: number;
  /** The band name from methodology.yaml, such as "Fragile". */
  tier: string;
}

export interface Card {
  repo: string;
  before: CardSide;
  after: CardSide;
}

/** Width of `text` in pixels at `fontSize`, in the card's font. */
export type Measure = (text: string, fontSize: number, letterSpacing: number) => number;

const WIDTH = 1200;
const HEIGHT = 630;
const BACKGROUND = '#CEA5C7';
const FOREGROUND = '#471044';
const FONT = 'Space Grotesk';
// The brand replaces every "i" with 💩; the Noto Emoji subset supplies that one glyph.
const BRAND = 'V\u{1F4A9}becodedsh\u{1F4A9}t.com';
const HEADER_SIZE = 44;
const HEADER_MAX_WIDTH = WIDTH - 2 * 60;
const SCORE_SIZE = 240;
const TIER_SIZE = 32;
const TIER_SPACING = 6;
const PILL_HEIGHT = 64;
const PILL_PADDING = 28;

function column(x: number, side: CardSide, measure: Measure, filled: boolean): string {
  const tier = side.tier.toUpperCase();
  const pill = Math.round(measure(tier, TIER_SIZE, TIER_SPACING)) + 2 * PILL_PADDING;
  const outline = filled ? `fill="${FOREGROUND}"` : `fill="none" stroke="${FOREGROUND}" stroke-width="3"`;
  return [
    `<text x="${x}" y="400" font-size="${SCORE_SIZE}" text-anchor="middle" fill="${FOREGROUND}">${e(side.score)}</text>`,
    `<rect x="${x - pill / 2}" y="452" width="${pill}" height="${PILL_HEIGHT}" rx="${PILL_HEIGHT / 2}" ${outline}/>`,
    `<text x="${x}" y="495" font-size="${TIER_SIZE}" letter-spacing="${TIER_SPACING}" text-anchor="middle" fill="${filled ? BACKGROUND : FOREGROUND}">${e(tier)}</text>`,
  ].join('');
}

/** The card as SVG: the brand and repository, then the earlier score, an arrow and the new score, each with its tier below. */
export function cardSvg(card: Card, measure: Measure): string {
  const header = `${BRAND} report for ${card.repo}`;
  const width = measure(header, HEADER_SIZE, 0);
  // A long repository name shrinks the header instead of running off the card.
  const headerSize = width > HEADER_MAX_WIDTH ? Math.floor((HEADER_SIZE * HEADER_MAX_WIDTH) / width) : HEADER_SIZE;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="${FONT}" font-weight="700">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${BACKGROUND}"/>`,
    `<text x="${WIDTH / 2}" y="110" font-size="${headerSize}" text-anchor="middle" fill="${FOREGROUND}">${e(header)}</text>`,
    column(300, card.before, measure, false),
    `<text x="${WIDTH / 2}" y="346" font-size="120" text-anchor="middle" fill="${FOREGROUND}">→</text>`,
    column(900, card.after, measure, true),
    '</svg>',
  ].join('');
}

let wasm: Promise<void> | undefined;
let fonts: Uint8Array[] | undefined;

function options(): ResvgRenderOptions {
  fonts ??= ['SpaceGrotesk-Bold.ttf', 'NotoEmoji-Poop.ttf'].map((name) => readFileSync(path.join(packageRoot, 'assets', 'fonts', name)));
  return { font: { fontBuffers: fonts, defaultFontFamily: FONT } };
}

function measure(text: string, fontSize: number, letterSpacing: number): number {
  const probe = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><text font-family="${FONT}" font-weight="700" font-size="${fontSize}" letter-spacing="${letterSpacing}">${e(text)}</text></svg>`,
    options(),
  );
  const box = probe.getBBox();
  const width = box?.width ?? 0;
  box?.free();
  probe.free();
  return width;
}

/** Render the card to a PNG with the bundled fonts only, so it looks the same on every machine. */
export async function renderCard(card: Card): Promise<Uint8Array> {
  wasm ??= initWasm(readFileSync(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm')));
  await wasm;
  const resvg = new Resvg(cardSvg(card, measure), options());
  const image = resvg.render();
  const png = image.asPng();
  image.free();
  resvg.free();
  return png;
}
