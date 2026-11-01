# health

Codebase Health benchmark. See `methodology/v1.0/METHODOLOGY.md` for how scores work.

```
npm install
npm run health -- scan <path> --preview [--as-of YYYY-MM-DD] [--out run.json]
```

A preview scan runs the static layer only, measures the parameters implemented so far (currently 4.2 Lines in large files) and writes a run.json marked "preview, not comparable". Without `--preview` the scan is a full run: install, build, typecheck, lint, the tests and every static analysis tool run in the pinned `health:1.0` image (`npm run image:build`, Docker needed, no other tool on the host), which adds 6.1, 2.1 and 2.5. A full run is not comparable until 1.1 to 1.3 and 6.3 are measured. Full runs keep the package managers' downloads in `~/.cache/health/packages` (or `$XDG_CACHE_HOME/health/packages`) so a second scan does not download them again. Set `HEALTH_PACKAGE_CACHE` to another directory, or to `off` to download everything on every scan.

Needs Node 22 or later, `git`, and `python3` for repositories with Python files.

## Claude Code plugin

The CLI ships as a Claude Code plugin with a `/codebase-health` skill. The plugin root is this directory; the marketplace file is `.claude-plugin/marketplace.json` at the repository root.

```
/plugin marketplace add Raavn/vibecodedshit.com
/plugin install codebase-health@vibecodedshit
/codebase-health [path]
```

The namespaced form `/codebase-health:codebase-health` also works. The skill runs a full scan when Docker and the `health:1.0` image are available. When Docker is running but the image is missing, it builds the image in the background while it runs a preview scan, then runs the full scan. When Docker is missing or not running, it asks whether to run a preview scan, which is not comparable, or wait while you install or start Docker. It then renders the HTML report, and from the second scan of a repository on (same mode) a PNG card with the previous and new score and their bands, and explains `run.json`: the health score and band, the weakest dimension and the three parameters most worth fixing. Claude only reads the scores. It never computes or adjusts them, and it sends something only after you have seen the exact payload and said yes.

## Submitting a result

Submission is opt-in. `health submit <run.json> --email <addr> [--confirm] [--newsletter] [--include-repo-name] [--summary-file <path>]` prints the full payload and sends it to app.vibecodedshit.com only with `--confirm`. The skill shows the payload and asks, with No as the default. Privacy page: https://app.vibecodedshit.com/privacy

- The repository is identified by the SHA-256 of its normalised git remote URL (the root commit when there is no remote). The name is sent only with `--include-repo-name`.
- The email is required. It is used for your rank, for methodology version notices, and for the newsletter only with `--newsletter`.
- The CLI prints your rank and the score needed for the top 10 on that methodology version. Nobody else's scores are published.
- Only a comparable full run can be submitted. Source code and file paths are never sent.
- The first email to submit a repository on a methodology version owns its entry; a different email gets a 409. The owner can re-submit to replace it, if the new run's as-of date is not earlier.
- Exit codes: 0 printed or sent, 1 usage error or refusal, 6 sending failed.

Installing by the GitHub slug works only for users whose git credentials can read the repository.

Development: `dist/` is committed because plugin installs don't run a build. Run `npm run build` and commit `dist/` with any change under `src/`. `npm run verify` fails if `dist/` is stale. When you bump `version` in `package.json`, bump it in `.claude-plugin/plugin.json` too.
