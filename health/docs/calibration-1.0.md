# Calibration of methodology 1.0 on ServerRoot repositories

> **Internal: contains private repository names and scores; remove or redact before publishing this repository.**

Mind task 163fbc37. Proposals only: nothing under `methodology/` changes here and the version stays 1.0. Peter decides which changes to make.

## 1. Run setup

| | |
|---|---|
| Date | 2026-10-12 |
| Methodology | 1.0 |
| As-of date (all runs) | 2026-10-12 |
| CLI commit | `ecd8d762a60502a8b5be3a8f90139c6d1669ea80` (vibecodedshit.com `main`) |
| Image | `health:1.0`, `sha256:8b7198554b895e12cfde074f3c2fe025fb63719fc43d19299eba460b80923700` |
| Static tools | knip 6.39.0, dependency-cruiser 18.5.0, eslint 9.39.5, eslint-plugin-sonarjs 4.2.2, jscpd 5.4.0, osv-scanner 2.6.0, gitleaks 8.30.1, complexipy 8.0.1, vulture 2.16, deptry 0.25.1, grimp 3.17, import-linter 2.15 |
| Machine | Linux, Intel i3-12100, 8 CPUs, 31 GB RAM, docker-ce 29.8.2 (containers capped at the methodology's 4 CPU / 8 GB) |
| Mode | Attended run in a Claude Code session, not the unattended loop |

Each repository was cloned with `git clone --no-hardlinks` into a temporary directory (committed files at HEAD only, so untracked `.env` files never reach the scan) and scanned with `npm run health -- scan <copy> --as-of 2026-10-12 --out <dir>/run.json`, then `health report`. run.json and report.html stayed in the session's temporary directory and are not committed.

## 2. Selection

**Rule** (from the task): one Next.js + Prisma app, one Python project, one monorepo or mixed-language repository, then up to two optional repositories, one of them with no tests.

**Survey.** For every git repository under `~/ServerRoot` and `~/ServerRoot/___archive`: count of tracked TS/JS and Python files, test files, `prisma/schema.prisma`, `next.config.*`, `workspaces` in the root `package.json`, and Python manifests. The 2026-10-03 survey was taken on another machine. Three of its picks (`___archive/claude-osint`, `___archive/corporide`, `better-change-now-networking`) are not on this host, so the selection was redone here.

| Candidate | TS/JS files | Python files | Test files | Notes | Picked |
|---|---|---|---|---|---|
| aimeko-os | 229 | 0 | 75 | Next.js + Prisma, vitest | 1: Next.js + Prisma |
| laya-server | 0 | 8 | 3 | `pyproject.toml`, pytest; the only Python project with a manifest | 2: Python |
| ovai | 887 | 1 | 336 | Next.js + Prisma, a second package in `api/`, three JS lockfiles (npm, bun, deno), one Python script; largest repository | 3: mixed language and size |
| offer-roast | 59 | 0 | 0 | Next.js + Prisma, no tests | 4: "no tests" path |
| infinite-mind | 434 | 0 | 147 | Next.js + Prisma | not run: ovai already covers size |
| restorative.dev | 32 | 1 | 2 | dirty tree, vendored packages | no |

**Gaps.** No workspace monorepo exists under ServerRoot (no root `package.json` has `workspaces`), so workspace pooling is not exercised. ovai's mixed-language pooling covers one Python file only. laya-server is small (192 logic lines), so the Python path is exercised end to end but not at size. Recommendation (to Peter): calibrate the Python and monorepo paths on an external open-source stand-in.

## 3. Results per repository

Two of the four planned runs ended in a tool error (exit 4), both caused by the same CLI defect (section 5, item W1). To still get evidence on the other 29 parameters, both repositories were scanned again with one change: `npm ci --ignore-scripts` ran in the copy before the scan, so knip could load the repository's config. These **workaround runs** (marked `*`) are not methodology runs. The installed `node_modules` is untracked, so it doesn't enter the scope, but it may change what knip and dependency-cruiser resolve.

| Repository | Exit | Health | Band | D1 | D2 | D3 | D4 | D5 | D6 | Scan time | 6.3 feedback loop (typecheck / lint / tests) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| laya-server | 0 | 73 | Stable | 93 | 51 | 79 | 75 | 85 | 58 | 13 s | 3.1 s (1.0 / 0.2 / 2.0) |
| aimeko-os | 4 | not scored | | | | | | | | 219 s | |
| aimeko-os `*` | 0 | 61 | Stable | 75 | 78 | 46 | 59 | 50 | 55 | 198 s | 48.0 s (13.6 / 14.6 / 19.8) |
| offer-roast | 0 | 30 | Vibe-coded (capped by D1) | 0 | 79 | 79 | 72 | 42 | 30 | 54 s | 5.0 s (2.0 / 3.0 / 0) |
| ovai | 4 | not scored | | | | | | | | 66 s | |
| ovai `*` | 0 | 35 | Vibe-coded | 29 | 26 | 63 | 53 | 25 | 13 | 52 s | 0 s (install failed) |

**Tool errors.** aimeko-os and ovai: `knip exited with 2: ERROR: Error loading vitest.config.ts (Cannot find module 'vitest/config')`.

**Warnings from run.json.**
- laya-server: `5.1: . has no lockfile, its dependencies were not scanned`, `5.2: . has no lockfile, dependencies not checked`.
- offer-roast, aimeko-os `*`: `6.2: package-json:build|dev|start calls next, which is not a recognised tool`.
- ovai `*`: the two laya-server lockfile warnings for the Python unit, `5.5: . has no Python dependency manifest`, `6.6: CLAUDE.md:206: python3 .claude/skills/shapes/check.py --strict does not resolve`.

## 4. Parameters at 0 or 100

L = laya-server, R = offer-roast, A = aimeko-os `*`, O = ovai `*`.

| Param | Runs at 0 / 100 (raw) | Reason | Verdict |
|---|---|---|---|
| 1.1–1.3 | R 0 (no tests); O 0 (install failed); L 1.1 100 (13/13) | No suite, or the install failure zeroes execution parameters | Legitimate (by the rule) |
| 1.4 | R 0 (0/50) | No tests | Legitimate |
| 1.5 | R 0 (0/0); L, A 100 | No tests; every case asserts | Legitimate |
| 2.1 | R, A 100 (0 errors); O 0 (install failed) | | Legitimate |
| 2.2 | L 0 (`none`) | No pyright/mypy config | Legitimate |
| 2.3 | L 100 (0/1k) | | Legitimate |
| 2.4 | R, A, O 100 | TS parameters typed everywhere | Legitimate |
| 2.5 | L 100; O 0 (install failed) | | Legitimate |
| 3.1 | all four 0 (`none`) | No repository declares boundary rules | Legitimate |
| 3.2 | L 100 (0/5 edges); R 100 (0/9 edges) | R's denominator misses alias imports (5, W2) | **Suspect** (R) |
| 3.3 | all four 100 (0% in a cycle) | R and O measured on relative imports only (W2) | **Suspect** (R, O); legitimate (L, A) |
| 4.1 | L 100 | | Legitimate |
| 4.2 | L, R 100 | No file over 500 logic lines | Legitimate |
| 4.3 | L 100 | | Legitimate |
| 4.4 | L 0 (25%, 4/16); O 0 (29.6%) | L: all four findings are stdlib callbacks (W3) | **Suspect** (L); O not checked |
| 5.1 | L 100 (no lockfile, no dependencies); R 0 (178 points); A 0 (228); O 0 (896) | R: `next@16.1.6` has 35 advisory groups, `nodemailer@8.0.11` 8 | Legitimate; see proposal P4 |
| 5.2 | L 100 (0/0) | No dependencies | Legitimate |
| 5.3 | L 0 (`none`); R, A 100; O 100 for the TS unit | L declares zero dependencies. O: 5.3 says in sync while install used a stale `bun.lock` (W5) | L: see P3. O: **suspect** |
| 5.4 | L, R, A 100; O 0 (14 findings) | O: a committed `.env` (generic-api-key, jwt), JWTs in `docs/ovai-db/*.sql`, `src/integrations/ovai-supabase/client.ts`, generic-api-key in four source files and one test | Legitimate; finding sent to Peter outside this document |
| 5.5 | L 100 (0/2); R 0 (38.1%, 8/21) | R: knip flags `prisma`, `husky`, `tsx`, `lint-staged`, `react-dom`, `@types/react-dom` (W1) | **Suspect** (R) |
| 6.1 | L, A 100; O 0 (TS `install_fails`, Python `works`) | O: `bun install --frozen-lockfile` fails, "lockfile had changes, but lockfile is frozen" | Legitimate (the repository's `bun.lock` is stale) |
| 6.2 | L 0 | No verify entry point | Legitimate |
| 6.3 | L, A 100; R 0 (no test runner); O 0 (install failed) | R: missing tests score 0 by rule, although typecheck + lint ran in 5 s | Legitimate by rule; see P6 |
| 6.4 | all four 0 | No CI on R, A, L; O has deploy-only workflows | Legitimate |
| 6.5 | L 100; A 0; O 0 | L: `requires-python = ">=3.11"` counts as pinned. A: no `.env.example` (0/15 documented) | L: see P5. A, O: legitimate |
| 6.6 | A 100 (`agent_file`) | | Legitimate |

## 5. Results that look wrong

**W1. 4.4 and 5.5 (and any TS/JS repository with a vitest config): knip runs on an uninstalled tree.**
- aimeko-os and ovai: the scan exits 4 with `Error loading vitest.config.ts (Cannot find module 'vitest/config')`. Every repository with a `vitest.config.ts` gets a tool error.
- offer-roast (no vitest config, so the run completed): 5.5 = 38.1% (8/21), score 0. knip flags `prisma` (used by the `postinstall` script), `husky` (`prepare`), `tsx` (`db:seed`), `lint-staged` (config in `package.json`, run from `.husky`), and `react-dom` and `@types/react-dom`, which Next.js needs. Only `nodemailer` and `@types/nodemailer` are plausibly real. With 2/21 (9.5%) the score would be about 64 instead of 0.
- Likely cause: measurer defect. `src/tools/knip.ts` runs knip in the repository copy with no `node_modules`, so knip cannot load plugin configs or map script binaries to packages. Evidence: the stderr above, and in the workaround runs with `npm ci` in the copy, aimeko-os completes and its 5.5 is 6.9% (2/29).

**W2. 3.2 and 3.3: `paths` alias imports (`@/…`) never become graph edges.**
- offer-roast: 95 `@/` imports and 12 relative imports in non-test TS files, but 3.2's denominator is 9 edges.
- ovai: 1,309 `@/` imports and 643 relative imports, but 507 edges.
- aimeko-os uses relative imports (259, plus one alias) and has 193 edges, which is consistent.
- So for any repository that imports through a tsconfig alias, 3.2 and 3.3 only see relative imports. Cycles and violations through aliases are invisible, and both score near 100 by default. `src/measure/d3/ts/adapter.ts` passes the parsed tsconfig and emitted no warning, so the cause isn't confirmed yet. Likely cause: measurer defect in alias resolution.

**W3. 4.4 Python: stdlib callback methods count as unused.**
- laya-server: vulture reports `do_GET`, `do_POST`, `do_OPTIONS` and `log_message` on a `BaseHTTPRequestHandler` subclass in `laya_server/server.py`, all at 60% confidence. The standard library calls them by name. These are the four unused symbols counted (4/16 = 25%), so 4.4 = 0 and D4 = 75 instead of 100.
- Likely cause: the min-confidence 60 deviation (section 7) combined with no handling for overridden base-class methods.

**W4. 4.3: duplicated lines are counted in both copies of a clone.**
- aimeko-os `*`: 4.3 = 18.4% (2,383/12,930), score 8. jscpd's own report for the same non-test `src` files (12,866 lines, `--min-tokens 50 --min-lines 5`) gives 1,649 duplicated lines = 12.8%, score about 36.
- The YAML defines 4.3 as "Duplicated lines / all lines in logic files, as reported by jscpd". `src/measure/p4-3.ts` rebuilds per-file numbers and appears to count both sides of each clone. The duplication itself is real: copied API route handlers of 32–61 lines.
- Likely cause: a definition ambiguity (P2), not a tool defect.

**W5. 5.3 and 6.1 look at different lockfiles.**
- ovai has `package-lock.json` (last changed 2026-09-07), `bun.lock` (2026-07-21) and `deno.lock`. The install step prefers bun (`src/exec/steps/lockfiles.ts`) and fails because `bun.lock` is stale, so 6.1 = 0 and every execution parameter = 0. 5.3 still reports the TS unit as `in_sync`.
- Likely cause: 5.3 and the install step pick a lockfile independently.

**W6. CLI text summary (display only, scores are unaffected).**
- `health scan` prints `%` for per-1,000 ratios: laya-server's 2.1 shows `16.8%`, which is 16.8 per 1,000 lines.
- It prints `n/a` when the raw value is stored only per unit, for example 6.3 at 3.1 s and 5.4 at 0 findings.
- Cause: `src/cli.ts` lines 47–53.

**Observations (surprising, not contradicted by a fact):**
- laya-server 2.1: 2 of the 6 pyright errors are `reportMissingImports` for the optional extras `laya_mlx` and `laya`, which the install doesn't install (see P7).
- aimeko-os `*` 1.1: 396/397 tests pass. The failing test wasn't inspected, so it could be the no-network rule.
- offer-roast 6.1 = 40 (`build_fails`). `src/lib/pixel/fonts.ts` imports `next/font/google`, which downloads at build time, and the build step runs with the network off. Any Next.js app using Google Fonts will get 40.
- ovai 6.1 pools to 0.3, not 0: the Python unit (1 file, `works`) carries a tiny weight. "Install failure zeroes every E parameter" holds per unit, not for the pooled value.

## 6. Proposed anchor or definition changes

Each item below is a proposal only.

| # | Param | Current | Proposal | Supported by | Expected effect |
|---|---|---|---|---|---|
| P1 | 4.4 Python | "vulture with min-confidence 60 … decorated definitions are treated as used" | Also treat methods that override a base-class method (for example `do_*` and `log_message` on `http.server` handlers) as used, or go back to min-confidence 80 for methods | W3 | laya-server 4.4: 0 → 100, health 73 → about 78 |
| P2 | 4.3 | "Duplicated lines / all lines in logic files, as reported by jscpd" | State which count: lines in every copy (SonarQube style, current code) or jscpd's own `duplicatedLines`. If every copy, keep the anchors; if jscpd's, the 3/5/10/20 anchors are already strict | W4 | aimeko-os 4.3: 8 ↔ about 36 depending on the choice |
| P3 | 5.3 | "Whether a lockfile exists and matches the manifest", none → 0 | Not applicable when the manifest declares no dependencies | laya-server (`dependencies = []`, 5.3 = 0) | laya-server D5 85 → 100 |
| P4 | 5.1 | Severity points 0 → 100, 2 → 75, 10 → 50, ≥30 → 0 | Keep the anchors. Consider capping the points per package so one framework release (35 advisories on `next@16.1.6`) doesn't saturate the scale on its own | R 178, A 228, O 896 | Every Next.js app a few patch releases behind currently scores 0 |
| P5 | 6.5 | `runtime_pinned`: "requires-python in pyproject.toml" or `engines.node` counts | Count only a pin with an upper bound or an exact version (`.python-version`, `.nvmrc`, `~=3.12`, `<3.13`). A floor like `>=3.11` isn't reproducible | laya-server | laya-server 6.5: 100 → 50 |
| P6 | 6.3 | Missing tests = 0 | Keep. It's the methodology's rule, and offer-roast is already zeroed in D1. Listed only because 6.3 and D1 then penalise the same fact twice | offer-roast | none |
| P7 | 2.1 Python | Typecheck with the repository's installed dependencies | Install declared optional extras too, or don't count `reportMissingImports` for modules named in `[project.optional-dependencies]` | laya-server | laya-server 2.1: 11 → about 29 |
| P8 | 5.3 / 6.1 | Picked independently | One lockfile choice per unit shared by 5.3 and install. With several JS lockfiles, score 5.3 `out_of_sync` unless all agree | ovai (W5) | ovai 5.3: 100 → 40 for the TS unit |

## 7. Open deviations recorded in Mind task 443891db

From the section "Deviations from the grilling, to confirm with Peter" as of 2026-10-12. The 2026-10-05 Q&A on that task treats them as accepted. This section lists what the runs show and doesn't judge them.

| Deviation | Evidence from these runs |
|---|---|
| 4.4 Python: vulture min-confidence 60, not 80; decorated definitions treated as used | laya-server: all 4 findings are at 60% confidence, all stdlib callbacks (W3). At 80 none would be reported and 4.4 would be 100. The decorated-definition rule was not exercised |
| D3: declared rules replace the preset (alternative: union) | No evidence in this sample: no repository declares rules (3.1 = `none` everywhere) |
| Timeouts: install/build 15 min, typecheck/lint/tests 10 min | No evidence in this sample. The longest step was the aimeko-os test run at 19.8 s; the longest scan 219 s |
| Runner 4 CPU / 8 GB | No evidence in this sample: no step came near a limit |
| Unknown severity treated as moderate | Not checked in this sample (the 5.1 severity mix wasn't broken down) |
| e2e (Playwright/Cypress) not run | No evidence in this sample: no repository has a Playwright or Cypress config |
| No external services (tests needing a database fail) | Possibly aimeko-os `*` 1.1 (1 of 397 failing, not inspected). offer-roast 6.1 `build_fails` is the related network-off rule (Google Fonts) |
| 6.6: only AGENTS.md/CLAUDE.md count; an agent file with a broken command drops to 50 | ovai: `CLAUDE.md:206` names a command that doesn't resolve, 6.6 = 50. aimeko-os: agent file with resolving commands, 100 |
| 5.2 includes dev dependencies | offer-roast 7/21, aimeko-os 11/29, ovai 30/84: the denominators include dev dependencies |
| Hotspot window 12 months | Report only. Present in every run, no scoring effect |
| `.gitleaksignore` honoured | No evidence in this sample: no repository has one |
| Env-example values loaded into the run | offer-roast has `.env.example` (6/6 names documented). No result shows the values' effect |

## 8. Limitations

- One run per repository; 6.3 varies between runs. Run times are from one machine.
- Two of the four planned runs needed the workaround install (section 3), so their D4 and D5 may differ from a fixed CLI.
- Python is covered by one small project and one script; workspace monorepos not at all (section 2).
- laya-server's numbers rest on 192 logic lines, so one finding moves a parameter a lot.
- Root causes in section 5 are likely causes from reading the code and reproducing the tool call, not confirmed fixes.
- Run files (uncommitted, deleted with the session): `run.json` and `report.html` for each run under the session scratchpad, in `cal/out/<repository>/`.
