---
name: codebase-health
description: Scan a codebase with the Codebase Health benchmark, render the HTML report and explain the result.
argument-hint: "[path]"
disable-model-invocation: true
---

# Codebase health

Scan a repository with the Codebase Health benchmark and explain the result. The CLI measures and scores. You only run it and read what it wrote.

## Rules

- You never measure, compute, estimate, round or adjust a score. Every number you state is copied from run.json, the methodology YAML or the health CLI's output.
- Send nothing anywhere except a payload the user has seen and confirmed in this run. Submitting a result is opt-in (the Submit step). Never pass --confirm before the user has answered yes in this conversation. Never submit from an unattended run.
- A preview result is not comparable; say so.
- Make the quote offer only when health.band is vibe_coded or fragile and `reportOnly.pythonInScope` in run.json is `false`.
- Never change, delete or update anything on your own. That includes old runs and the plugin itself.
- This is a scan. Its job is to finish the scan and report the result. Never start fixing the codebase yourself. The only offer you make is the free quote in the last step.
- Assume the user does not know Docker or the terminal. Never hand them a command to run. Never install Docker or start its daemon yourself; ask the user to do that.
- Narrate in plain words, tailored to this repository. The wording below is guidance, not a script.
- Sorting stored values is allowed. Recomputing or estimating a score is not.

## Steps

### 0. Dependencies

If `${CLAUDE_PLUGIN_ROOT}/node_modules` does not exist, run `npm ci --omit=dev --ignore-scripts` with `${CLAUDE_PLUGIN_ROOT}` as the working directory, say so in one line, and continue. If it fails, show the error and stop.

### 1. Target, branch and output directory

Target: `$ARGUMENTS` if given, else the output of `git rev-parse --show-toplevel` in the working directory, else the working directory.

Create the run directory and remember its absolute path as RUN_DIR:

```
mkdir -p "${CLAUDE_PLUGIN_DATA}/runs/<UTC timestamp, YYYYMMDDTHHMMSSZ>"
```

Write everything for this run there. Never write `run.json` or the report into the scanned repository.

Branch: the branch the user names, else `main`. Scan the latest commit of that branch, never whatever the target happens to have checked out. Never switch, pull into or otherwise change the target's own checkout. When the target is a git repository:

1. Run `git -C <target> fetch origin <branch>`. When it succeeds, the commit is `origin/<branch>`. When it fails (no `origin` remote, or no such branch there), use the local `<branch>`; when that does not exist either, say so and stop.
2. CHECKOUT is `${CLAUDE_PLUGIN_DATA}/checkouts/<basename of the target>`. When it already exists, run `git -C <target> worktree remove --force "<CHECKOUT>"` and `git -C <target> worktree prune` first.
3. Run `git -C <target> worktree add --detach "<CHECKOUT>" <commit>`.
4. Tell the user in one line which branch and short commit SHA is scanned. From here on, `<target>` in every command means CHECKOUT.
5. As the last thing you do in the run, whichever step it ends at, run `git -C <original target> worktree remove --force "<CHECKOUT>"`.

When the target is not a git repository, scan it as it is; when the user named a branch, say it could not be used.

### 2. Full scan or preview

Open with one line naming the repository: "I'm going to take you through the health scan of <basename of the target path>."

Run `docker info` and `docker image inspect health:1.0 --format '{{ index .Config.Labels "dev.vibecodedshit.health.revision" }}'`. The image is current when the printed revision equals the value on the `LABEL dev.vibecodedshit.health.revision` line of `${CLAUDE_PLUGIN_ROOT}/docker/Dockerfile`.

- Both succeed and the image is current: tell the user in one line that a full scan runs their install, tests, build and every check inside Docker, with network access only during dependency install and the vulnerability lookup. Then scan:
  `node "${CLAUDE_PLUGIN_ROOT}/dist/bin.js" scan <target> --out "<RUN_DIR>/run.json"`
- Docker is running but the image is missing or out of date (a different revision, or none): say in one or two lines that Docker is running but the `health:1.0` image is not there or is from an older plugin version, and what the image is for: it is the pinned environment that runs install, build, typecheck, lint, tests and the static analysis tools, which makes a full scan reproducible and comparable. Without it only the static checks run. Say you will run the parts that do not need the image while you build it. Then start both with the Bash tool in the background, without asking first:
  - the build: `npm --prefix "${CLAUDE_PLUGIN_ROOT}" run image:build`
  - the preview scan below, writing to `<RUN_DIR>/preview/run.json`

  When the preview finishes first, give one interim line with its health and band, say it is not comparable and that the full scan follows. Do not explain the preview further. When the build succeeds, run the full scan above and continue with steps 3 to 7 on the full run. When the build fails, show the last lines of its output, say the full scan could not run so the preview result is not comparable, copy the preview run to `<RUN_DIR>/run.json`, and continue with steps 3 to 7 on the preview run.
- `docker` is not found: say Docker is not installed. `docker info` fails: say Docker is installed but not running. Then ask the user with AskUserQuestion. Options: "Run a quick preview scan now" (static checks only, result not comparable) and "I'll install Docker or start it" (when the user says it is ready, run the checks above again). On the preview option, say in one line that the result is not comparable, and run the preview scan below.

Preview scan:
  `node "${CLAUDE_PLUGIN_ROOT}/dist/bin.js" scan <target> --preview --out "<RUN_DIR>/run.json"`

Never retry a failed full scan as a preview.

A full scan can take many minutes. Run it with the Bash tool in the background and wait for the completion notice. Do not poll with `sleep`.

Exit codes:

- 0: continue. A tool that failed leaves its parameters not measured and the run not comparable; `comparableReason` names each one.
- 1, 2 or 3: show stderr and stop. There is no run.json.
- 4: Docker or the image failed, and run.json has `valid: false`. Show `invalidReason`, produce no report and no explanation, and stop.

### 3. Report

Run, with `<RUN_DIR>` as the working directory:

`node "${CLAUDE_PLUGIN_ROOT}/dist/bin.js" report "<RUN_DIR>/run.json" --out "<RUN_DIR>/health-report.html"`

The first line it prints is the absolute report path; give the user that path. When the run has a health score, up to 3 more lines follow: the top of the report's Roadmap.

Then run, with `<RUN_DIR>` as the working directory:

`node "${CLAUDE_PLUGIN_ROOT}/dist/bin.js" card "<RUN_DIR>/run.json" --history "${CLAUDE_PLUGIN_DATA}/runs" --out "<RUN_DIR>/health-card.png"`

When this repository was scanned before in the same mode, it writes a PNG card with the previous score, the new score and the band under each, and prints the card's absolute path; give the user that path. When it prints nothing on stdout, this is the first such run: say nothing about a card.

### 4. Explain

Read `<RUN_DIR>/run.json` and `${CLAUDE_PLUGIN_ROOT}/methodology/v<version>/` (the version is `methodology.version` in run.json). Say, in this order:

1. Health `health.displayed` and the band name (match `health.band`, a key such as `vibe_coded`, to `bands[].name` in `methodology.yaml`), plus the mode. When `comparable` is false, say it is not comparable and give `comparableReason`. List `warnings` in one line when there are any.
2. The weakest dimension: the lowest non-null `dimensions[].score`. The name comes from `dimension.name` in `dimensions/<id>-*.yaml`.
3. The top 3 Roadmap lines `health report` printed in step 3, in the same order, restated in plain words. Each line reads `<rank>. <id> <parameter name> (<dimension name>) +<gain> — <target descriptor>`. Gain is the whole health points the health would rise by if that parameter alone reached 100; `+0 · no gain` means none. Do not change any number or descriptor, and never write a descriptor of your own. State Gains as facts, with no imperative wording. When the CLI printed no Roadmap lines, say nothing about a roadmap. In a preview, say that execution-layer parameters were not measured, so they are not ranked.
4. The absolute report path, and one sentence saying the report has a visual summary and a Roadmap ranked by Gain. When step 3 wrote a card, its absolute path too.

Stop the explanation there. Do not add next steps or recommendations.

### 5. Submit (opt-in)

Skip this step, and do not mention submission, when the run is a preview, when `comparable` is false (the CLI would refuse), or when no user can answer (`claude -p`, a scheduled task, a subagent).

1. Write a summary of 3 to 6 sentences to `<RUN_DIR>/summary.txt`. It condenses the explanation from step 4 and contains no file names, paths, repository name, code or email.
2. Find the default email: the output of `git config user.email` in the target. Offer it only when it is not empty and does not end in `@users.noreply.github.com`.
3. Ask once with AskUserQuestion: "Submit this result to vibecodedshit.com? Default: No." with No as the first option. Default answer: No. Any answer other than an explicit yes means do nothing; say "Not submitted." and skip the rest of this step.
4. After a yes, ask for the email with AskUserQuestion. The default option is the address from item 2 when there is one; the user can pick Other to type a different one. The plugin stores nothing.
5. Ask "Include the repository name?" (default No) and "Also get the VCS newsletter?" (default No). State the exact `repoName` value that would be sent. Include the repository name and the newsletter only if the user opts in to each separately.
6. Run `node "${CLAUDE_PLUGIN_ROOT}/dist/bin.js" submit "<RUN_DIR>/run.json" --summary-file "<RUN_DIR>/summary.txt" --email <addr>`, adding `--include-repo-name` and `--newsletter` for the opt-ins the user accepted, without `--confirm`. Show the full payload before asking again. Show the privacy page link too: https://app.vibecodedshit.com/privacy
7. Ask "Send exactly this payload? Default: No." with AskUserQuestion. Only on an explicit yes run the same command with `--confirm`. Any other answer: say "Not submitted."
8. After `--confirm`, report success or the error. On success, copy the line the CLI printed, for example "Rank 7 of 42. Top 10 starts at 61.5.", and do not compute or reword it. When the CLI exits with an error, show it; a 409 means the repository was already submitted with a different email.

The email is used for the rank, for methodology version notices, and for the newsletter only when the user said yes.

### 6. Update check

Run `curl -fs --max-time 5 https://app.vibecodedshit.com/api/version`. It returns JSON like `{"plugin": "x.y.z", "methodology": "x.y"}`. On a non-zero exit, empty output, invalid JSON or any other shape, skip this step silently and never mention it.

Installed versions: plugin = `version` in `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`; methodology = `methodology.version` in run.json. Compare as numeric dotted versions.

- Newer plugin, print one line: `Update available: codebase-health <installed> -> <latest>. Run: claude plugin marketplace update vibecodedshit && claude plugin update codebase-health@vibecodedshit, then restart Claude Code.`
- Newer methodology, print one line: `Methodology <latest> is available (this run used <v>). Update the plugin the same way.`

Do not run the update.

### 7. Quote offer

Make this the last step, after the update check. Skip it, and print nothing, when `health.band` is not `vibe_coded` or `fragile`, when the band is null, when the run is invalid, when `reportOnly.pythonInScope` is not `false` (a missing value counts as Python), or when no user can answer (`claude -p`, a scheduled task, a subagent). It applies to preview and full runs.

1. Ask with AskUserQuestion: "Your score is <band name>. Peter's team at VCS will be happy to help you with that. Would you like a free, non-binding quote?" Options: "Yes" and "No thanks". Any answer other than an explicit yes means say nothing more and stop.
2. After a yes, ask in plain chat for the name, the email and an optional note. Offer the email given in the Submit step of this run as the default when there is one. Leave out `company` and a blank note.
3. Build the request body in `<RUN_DIR>/quote-request.json` with one call, passing RUN_DIR, the target path, the name, the email and the note as arguments:
   `node -e "<script>" "<RUN_DIR>" "<target>" "<name>" "<email>" "<note>"`
   The script reads `<RUN_DIR>/run.json` and `<RUN_DIR>/health-report.html` and writes a JSON object with: `contact` (`name`, `email`, and `note` when not blank), `methodologyVersion` = `methodology.version`, `health` = `health.displayed`, `band` = `health.band`, `repoHash`, `run` = the whole run.json object and `report` = the report file as a string. `repoHash` is the lower-case hex SHA-256 of the trimmed output of `git -C <target> remote get-url origin`, or of the absolute target path when there is no origin remote. Never include the repository name. The script copies values and computes nothing but the hash.
4. Show the user: `contact`, `health`, `band`, `methodologyVersion` and `repoHash` verbatim, the absolute paths of run.json and the report, and one line saying their full contents are sent too, that they contain file paths but no source code, and that the quote request goes to https://app.vibecodedshit.com/api/quote-requests. Show the privacy page link: https://app.vibecodedshit.com/privacy
5. Ask with AskUserQuestion: "Send this quote request? Default: No." Options: "Don't send" first, then "Send it". Any other answer: say nothing more and stop.
6. After "Send it", run:
   `curl -sS --max-time 30 -X POST -H 'Content-Type: application/json' --data-binary @"<RUN_DIR>/quote-request.json" -w '\nHTTP %{http_code}' https://app.vibecodedshit.com/api/quote-requests`
   HTTP 201 is success: say in one line that Peter's team has been notified and will reply by email. Anything else, or a curl error: show the error text and point to https://vibecodedshit.com.

Call it a "quote request", never a submission or an entry. It does not subscribe anyone to the newsletter.
