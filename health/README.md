# health

Codebase Health benchmark. See `methodology/v1.0/METHODOLOGY.md` for how scores work.

```
npm install
npm run health -- scan <path> --preview [--as-of YYYY-MM-DD] [--out run.json]
```

A preview scan runs the static layer only, measures the parameters implemented so far (currently 4.2 Lines in large files) and writes a run.json marked "preview, not comparable". Without `--preview` the scan is a full run: install, build, typecheck and lint run in the pinned `health:1.0` image (`npm run image:build`, Docker needed), which adds 6.1, 2.1 and 2.5. A full run is not comparable until 1.1 to 1.3 and 6.3 are measured. Full runs keep the package managers' downloads in `~/.cache/health/packages` (or `$XDG_CACHE_HOME/health/packages`) so a second scan does not download them again. Set `HEALTH_PACKAGE_CACHE` to another directory, or to `off` to download everything on every scan.

Needs Node 22 or later, `git`, and `python3` for repositories with Python files.

## Claude Code plugin

The CLI ships as a Claude Code plugin with a `/codebase-health` skill. The plugin root is this directory; the marketplace file is `.claude-plugin/marketplace.json` at the repository root.

```
/plugin marketplace add Raavn/vibecodedshit.com
/plugin install codebase-health@vibecodedshit
/codebase-health [path]
```

The namespaced form `/codebase-health:codebase-health` also works. The skill runs a full scan when Docker and the `health:1.0` image are available. When Docker is running but the image is missing, it builds the image in the background while it runs a preview scan, then runs the full scan. When Docker is missing or not running, it asks whether to run a preview scan, which is not comparable, or wait while you install or start Docker. It then renders the HTML report and explains `run.json`: the health score and band, the weakest dimension and the three parameters most worth fixing. Claude only reads the scores. It never computes, adjusts or submits them.

Installing by the GitHub slug works only for users whose git credentials can read the repository.

Development: `dist/` is committed because plugin installs don't run a build. Run `npm run build` and commit `dist/` with any change under `src/`. `npm run verify` fails if `dist/` is stale. When you bump `version` in `package.json`, bump it in `.claude-plugin/plugin.json` too.
