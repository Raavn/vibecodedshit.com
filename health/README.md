# health

Codebase Health benchmark. See `methodology/v1.0/METHODOLOGY.md` for how scores work.

```
npm install
npm run health -- scan <path> --preview [--as-of YYYY-MM-DD] [--out run.json]
```

A preview scan runs the static layer only, measures the parameters implemented so far (currently 4.2 Lines in large files) and writes a run.json marked "preview, not comparable". Without `--preview` the scan is a full run: install, build, typecheck and lint run in the pinned `health:1.0` image (`npm run image:build`, Docker needed), which adds 6.1, 2.1 and 2.5. A full run is not comparable until 1.1 to 1.3 and 6.3 are measured.

Needs Node 22 or later, `git`, and `python3` for repositories with Python files.

## Claude Code plugin

The CLI ships as a Claude Code plugin with a `/codebase-health` skill. The plugin root is this directory; the marketplace file is `.claude-plugin/marketplace.json` at the repository root.

```
/plugin marketplace add Raavn/vibecodedshit.com
/plugin install codebase-health@vibecodedshit
/codebase-health [path]
```

The namespaced form `/codebase-health:codebase-health` also works. The skill runs a full scan when Docker and the `health:1.0` image are available. Otherwise it runs a preview scan and says the result is not comparable. It then renders the HTML report and explains `run.json`: the health score and band, the weakest dimension and the three parameters most worth fixing. Claude only reads the scores. It never computes or adjusts them.

## Submitting a result

Submission is opt-in. `health submit <run.json> [--confirm] [--include-repo-name] [--email <addr>] [--summary-file <path>]` prints the full payload and sends it to app.vibecodedshit.com only with `--confirm`. The skill shows the payload and asks once, with No as the default. Privacy page: https://app.vibecodedshit.com/privacy

- The repository is identified by the SHA-256 of its normalised git remote URL (the root commit when there is no remote). The name is sent only with `--include-repo-name`, the email only with `--email`.
- Only a comparable full run can be submitted. Source code and file paths are never sent.
- Re-submitting a repository replaces its earlier entry, if the new run's as-of date is not earlier.
- Exit codes: 0 printed or sent, 1 usage error or refusal, 6 sending failed.

Installing by the GitHub slug works only for users whose git credentials can read the repository.

Development: `dist/` is committed because plugin installs don't run a build. Run `npm run build` and commit `dist/` with any change under `src/`. `npm run verify` fails if `dist/` is stale. When you bump `version` in `package.json`, bump it in `.claude-plugin/plugin.json` too.

## Licence

Everything outside `methodology/` is MIT (`LICENSE`). The contents of `methodology/` are CC BY 4.0 (`methodology/LICENSE`). Suggested attribution: "Codebase Health methodology by Peter Kisel, https://vibecodedshit.com, licensed under CC BY 4.0."
