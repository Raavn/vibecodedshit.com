# health

The Codebase Health benchmark CLI. Methodology v1.0 is in `methodology/v1.0/`; the YAML files are the source of truth for definitions, anchors and weights.

Run commands from this directory (`npm --prefix health <cmd>` from the repository root). Never add a `package.json` at the repository root: Vercel deploys the static site from there.

## Commands

- `npm run typecheck` runs `tsc --noEmit`
- `npm run lint` runs `eslint .`
- `npm run test` runs `vitest run`
- `npm run test:tools` runs the real Python tools (`pipx install complexipy vulture deptry && brew install osv-scanner gitleaks` first). Not part of `verify`.
- `npm run verify` runs all three. Run it before every commit.
- `npm run build` emits `dist/`
- `npm run health -- scan <path> --preview` runs a preview scan and writes `./run.json`

## Layout

- `src/methodology/`: loader and zod schemas. Anchors, weights, bands and the cap margin always come from the YAML, never from code.
- `src/scope/`: `git ls-files`, fixed exclusions, `.healthignore`, file roles, line counts, workspace packages. Python is parsed by `python/scope_helper.py` (stdlib only).
- `src/measure/`: one `Measurer` per parameter (`p4-2.ts`), listed in `registry.ts`. A measurer returns raw values per (package, language group) and never pools or scores.
- `src/tools/`: the injected `ToolKit` (resolve, run, fetch, memo), the tool catalog, work copies and the shared knip run. Measurers call tools only through `ctx.tools`; tests pass `fakeToolKit` from `test/helpers/tools.ts`. A missing or failing tool is `not_measured` in preview and a `ToolError` in full mode, never a score of 0.
- `src/scoring/`: pure scoring, pooling and aggregation.
- `src/run/`: `scan.ts` builds run.json, `recompute.ts` re-derives scores from stored raw values.

Adding a parameter: add `src/measure/p<d>-<n>.ts` and a test beside it, add one import and one entry to `registry.ts`, extend a fixture's `expected.json`. Do not change scoring, pooling, aggregation or the run.json shape.

## Fixtures

`test/fixtures/<name>/` hold hand-counted repositories with `expected.json`. They are not git repositories; `test/helpers/fixture.ts` copies one to a temp directory and runs `git init` and `git add`. Fixtures are excluded from tsc, eslint and vitest on purpose.

## Exit codes

0 ok, 1 usage error, 2 methodology error (no run.json), 3 no logic file (no run.json), 4 tool error (run.json with `valid: false`).
