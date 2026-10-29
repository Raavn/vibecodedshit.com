# vibecodedshit.com

## Vision
Let's make the vibecoded internet a better place. An open benchmark for codebase health. Health = how safely and cheaply someone with no memory of a codebase, whether a contractor or an AI agent, can make a correct change. Anyone can score their repository with a free Claude Code skill. Vibe-coded and Fragile results get an offer of a free, non-binding quote from Peter to fix the codebase.

Replaced the earlier vision (an awareness campaign about vibe-coding apps that already exist) on 2026-10-02.

## Tone
Snappy, sarcastic, slightly controversial — but always educative. Not preachy. Think "the friend who roasts you but has a point."

## Approach
1. **The methodology**: Six dimensions, 30 parameters, fixed rubrics, one health score and a band (Vibe-coded, Fragile, Stable, Agent-ready). Published under CC BY 4.0. Source: `health/methodology/v1.0/` in this repository.
2. **The skill**: A Claude Code plugin with `/codebase-health`. The engine (`health/`) is licensed under the Elastic License 2.0. It runs the pinned scoring tool, then Claude explains the result. Without Docker it runs a static-only preview that is marked "not comparable" and cannot be submitted.
3. **Submissions**: With the user's consent, the skill sends the scores to app.vibecodedshit.com. The repo name is off by default; a hash of the git remote URL is sent instead. The user sees the exact payload before anything is sent.
4. **The average and your rank**: The site shows the average score of submitted projects, counting each repo once (its latest full run, per methodology version). Each submitter sees their own rank and the score needed to reach the top 10, per methodology version. There is no public leaderboard; Peter has a private full leaderboard.
5. **Lead generation**: Vibe-coded and Fragile results end with an offer of a free, non-binding quote from Peter to fix the codebase.

## Brand Identity
- The letter "i" is always replaced with the poop emoji in brand text
- A single-use plastic disposable spoon is the brand symbol — wasteful, unnecessary, already exists in better forms
- Color palette: `#CEA5C7` (mauve background), `#471044` (dark purple foreground)

## Tech Stance
The site itself uses zero build tools, zero frameworks, zero npm packages. Plain HTML, CSS, and JavaScript. That's the point.

This rule applies to vibecodedshit.com only. The benchmark code in `health/` is not part of the site: it may use npm packages and has its own `package.json` there. There is no `package.json` at the repository root, and `.vercelignore` keeps `health/` out of the site deploy. app.vibecodedshit.com (the submission app) may use npm packages and a framework.

## Repository layout
- Repository root: the static site (`index.html`, `DESIGN.md`, this file). Vercel deploys it from the root with no build step.
- `methodology/index.html`: the public copy of `health/methodology/v<version>/METHODOLOGY.md`, served at `/methodology/` (`health/` is not deployed). Hand-copied, so update it whenever the methodology changes.
- `api/track.js`: zero-dependency Vercel function that turns visitor-tracking events from `index.html` into Telegram pings via x.aimeko.com notify. Needs `AIMEKO_TOKEN` on the Vercel project.
- `health/`: the codebase-health benchmark. `health/methodology/v1.0/` holds the versioned methodology; the `health` CLI and the Claude Code plugin are built there. It moved here on 2026-10-04 from the local-only `vibevibevibe.com` folder.

## Glossary
- **Gain**: the whole health points the displayed health would rise by if that one parameter alone reached 100. Zero shows as `+0 · no gain`. Gains are independent and do not add up, because the dimension means and the cap interact.
- **Roadmap**: the parameters ranked by Gain. The report shows the top 10; `health report` prints the top 3 after the report path.
