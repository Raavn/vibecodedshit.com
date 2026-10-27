/** Inline CSS. No external font, image or request. */
export const STYLE = `
:root { color-scheme: light dark; --bg: #fafaf8; --fg: #1c1c1a; --muted: #6b6b66; --line: #dcdcd4; --accent: #2b5fd9; --warn: #a15c00; --card: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg: #151514; --fg: #ecece6; --muted: #9a9a92; --line: #33332f; --accent: #7aa2ff; --warn: #e0a040; --card: #1e1e1c; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 16px 64px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 960px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 40px 0 8px; padding-top: 16px; border-top: 1px solid var(--line); }
.muted { color: var(--muted); }
.health { display: flex; gap: 24px; align-items: baseline; margin: 16px 0 8px; }
.health .score { font-size: 56px; font-weight: 700; line-height: 1; }
.health .band { font-size: 22px; font-weight: 600; }
.label { display: inline-block; padding: 2px 10px; border: 1px solid var(--warn); color: var(--warn); border-radius: 4px; font-weight: 600; }
table { width: 100%; border-collapse: collapse; background: var(--card); font-size: 14px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.bar { position: relative; min-width: 80px; height: 10px; background: var(--line); border-radius: 5px; overflow: hidden; margin: 6px 0; }
.bar span { display: block; height: 100%; background: var(--accent); }
.bar i { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--bg); }
a { color: var(--accent); }
code { font: 13px ui-monospace, monospace; word-break: break-all; }
.status-not_measured, .status-not_applicable { color: var(--muted); }
.status-failed { color: var(--warn); font-weight: 600; }
.note { color: var(--warn); margin: 4px 0 8px; }
`;
