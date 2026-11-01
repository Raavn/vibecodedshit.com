# vibecodedshit.com

## Vision
Let's make the vibecoded internet a better place. An open benchmark for codebase health. Health = how safely and cheaply someone with no memory of a codebase, whether a contractor or an AI agent, can make a correct change. Anyone can score their repository with a free Claude Code skill. Vibe-coded and Fragile results on TypeScript-only repos get an offer of a free, non-binding quote from Peter's team at VCS to fix the codebase.

Replaced the earlier vision (an awareness campaign about vibe-coding apps that already exist) on 2026-10-02.

## Tone
Snappy, sarcastic, slightly controversial — but always educative. Not preachy. Think "the friend who roasts you but has a point."

## Approach
1. **The methodology**: Six dimensions, 30 parameters, fixed rubrics, one health score and a band (Vibe-coded, Fragile, Stable, Agent-ready). Published under CC BY 4.0. Source: `health/methodology/v1.0/` in this repository.
2. **The skill**: A Claude Code plugin with `/codebase-health`. The engine (`health/`) is licensed under the Elastic License 2.0. It runs the pinned scoring tool, then Claude explains the result. Without Docker it runs a static-only preview that is marked "not comparable" and cannot be submitted.
3. **Submissions**: With the user's consent, the skill sends the scores and the email address the user gives to app.vibecodedshit.com. The repo name is off by default; a hash of the git remote URL is sent instead. The user sees the exact payload before anything is sent.
4. **The average and your rank**: The site shows the average score of submitted projects, counting each repo once (its latest full run, per methodology version). Each submitter sees their own rank and the score needed to reach the top 10, per methodology version. There is no public leaderboard; Peter has a private full leaderboard.
5. **Lead generation**: Vibe-coded and Fragile results on TypeScript-only repos end with an offer of a free, non-binding quote from Peter's team at VCS to fix the codebase. Other repos get no offer.

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
- **Submission**: one repo's latest full, comparable run for one methodology version, sent with the user's consent. A repo has at most one Submission per methodology version; a newer run replaces it. _Avoid_: score, entry, result.
- **Submitter**: the email address that first submitted a repo for a methodology version. Only the Submitter can replace that Submission or look up its rank. Each methodology version starts unclaimed. _Avoid_: owner, user, account.
- **Rank**: a Submission's position among all Submissions for the same methodology version, by health, highest first. Equal health shares a rank and the next rank skips (1, 2, 2, 4). Shown only to its Submitter. _Avoid_: position, place, leaderboard spot.
- **Top-10 threshold**: the health of the 10th-ranked Submission for a methodology version, the score a Submitter needs to reach the top 10. None while fewer than 10 Submissions exist.
- **Version notice**: an email saying a new methodology version has shipped, which starts a fresh ranking. Every Submitter and everyone who signs up for benchmark updates on the site gets them. Plugin releases get no email; the skill's update check tells users. _Avoid_: release email, newsletter.
- **VCS newsletter**: Peter's regular notes on codebase health and fixing it. Separate opt-in: submitting a score never subscribes anyone to it. _Avoid_: VCS notes, updates.
- **Pack**: the `/codebase-health` Claude Code plugin, given free in exchange for an email address and delivered as install instructions by email. It scores the repo, ranks the Roadmap, shows the shortest route to the next band, and writes execution slices into the repo for the user's agent to work through. There is one Pack, not a separate paid package. _Avoid_: package, kit, $49 package.
- **TypeScript-only**: a repo in which the scan finds no Python files, leaving out excluded folders. JavaScript counts as TypeScript. Only TypeScript-only repos get the quote offer. _Avoid_: JS repo, Node repo.
