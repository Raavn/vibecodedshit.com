# health

Codebase Health benchmark. See `methodology/v1.0/METHODOLOGY.md` for how scores work.

```
npm install
npm run health -- scan <path> --preview [--as-of YYYY-MM-DD] [--out run.json]
```

A preview scan runs the static layer only, measures the parameters implemented so far (currently 4.2 Lines in large files) and writes a run.json marked "preview, not comparable". Without `--preview` the scan is a full run: install, build, typecheck and lint run in the pinned `health:1.0` image (`npm run image:build`, Docker needed), which adds 6.1, 2.1 and 2.5. A full run is not comparable until 1.1 to 1.3 and 6.3 are measured. Full runs keep the package managers' downloads in `~/.cache/health/packages` (or `$XDG_CACHE_HOME/health/packages`) so a second scan does not download them again. Set `HEALTH_PACKAGE_CACHE` to another directory, or to `off` to download everything on every scan.

Needs Node 22 or later, `git`, and `python3` for repositories with Python files.

## Key

Every scan needs a free vibecodedshit key: get one at https://vibecodedshit.com/#run (it arrives by email), then put it in the `VIBECODEDSHIT_KEY` env var or run `health key set <key>`. With no key, or a key the server rejects, `scan` exits 6 and does not run. `VIBECODEDSHIT_APP_URL` overrides the host the key is validated against (for local testing).
