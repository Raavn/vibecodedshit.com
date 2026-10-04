# health

Codebase Health benchmark. See `methodology/v1.0/METHODOLOGY.md` for how scores work.

```
npm install
npm run health -- scan <path> --preview [--as-of YYYY-MM-DD] [--out run.json]
```

A preview scan runs the static layer only, measures the parameters implemented so far (currently 4.2 Lines in large files) and writes a run.json marked "preview, not comparable". Full runs need the `health:1.0` image, which is not available yet.

Needs Node 22 or later, `git`, and `python3` for repositories with Python files.
