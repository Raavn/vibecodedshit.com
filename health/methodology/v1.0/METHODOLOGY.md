# Codebase Health Methodology, version 1.0

This document explains how a codebase health score is computed and why each rule exists. The YAML files in this folder are the source of truth; section 6 is generated from them. If this document and the YAML disagree, the YAML is correct.

| File | Contents |
|---|---|
| `methodology.yaml` | Aggregation, bands, execution rules, delta rules, regression flags |
| `scope.yaml` | Which files count and how lines are counted |
| `dimensions/*.yaml` | The 30 parameters: weights, anchors, measurement, rationale, sources |
| `presets/*.yaml` | Default import rules for Next.js, Express, Django, FastAPI and generic projects |

## 1. Purpose

**Health is how safely and cheaply someone with no memory of this codebase, whether a contractor or an agent, can make a correct change.**

The methodology is built for three uses:

1. **Audits.** A run gives a baseline score, six dimension scores and the 30 parameter values behind them.
2. **Before and after.** A second run after the work shows what the fixes changed, parameter by parameter.
3. **Sprint-loop gate.** Every automated change is scored against its base commit. Regressions are flagged and never block.

It covers TypeScript, JavaScript and Python. Every parameter is computed from the repository by a tool. There are no surveys, no manual judgements and no AI grading. One parameter (6.3, feedback loop time) depends on wall-clock time and can vary slightly between identical runs; every other parameter gives the same result for the same commit, tool versions and as-of date.

## 2. How a score is computed

### Parameter score

Each parameter has a **raw value** measured from the repository, such as "62% line coverage" or "3.1 escape hatches per 1,000 lines". A fixed rubric turns the raw value into a score from 0 to 100.

Most rubrics are **piecewise-linear**: 3 or 4 anchors, each with a raw value, a score and a written meaning. Between two anchors the score is interpolated linearly. Below the first anchor and above the last, the score is clamped. Yes/no facts and configuration choices use **levels** instead, where each named level has a fixed score.

Example, 1.2 line coverage at 52%:

| Raw | Score |
|---|---|
| 40% | 50 |
| 60% | 75 |

52% is 12/20 of the way from 40% to 60%, so the score is 50 + 0.6 × 25 = **65**.

Anchors are fixed. They do not depend on other repositories, so a score means the same thing in every audit and every year until the methodology version changes.

### Dimension score

A dimension score is the weighted mean of its parameter scores. Weights within each dimension add up to 100.

Example, D1 Safety net:

| Parameter | Raw | Score | Weight | Contribution |
|---|---|---|---|---|
| 1.1 Suite pass rate | 97% | 70 | 20% | 14.0 |
| 1.2 Line coverage | 52% | 65 | 25% | 16.3 |
| 1.3 Branch coverage | 38% | 60 | 15% | 9.0 |
| 1.4 Modules with tests | 55% | 62.5 | 25% | 15.6 |
| 1.5 Tests that assert something | 92% | 70 | 15% | 10.5 |
| **D1** | | | | **65** |

### Not applicable

A parameter can be not applicable only when its precondition is a design choice the methodology does not score. In v1.0 there are two such cases:

- **3.4 Public-entry discipline**, when the repository has fewer than two modules.
- **3.5 Domain purity**, when the repository declares no domain layer.

The weight of a not-applicable parameter is spread over the other parameters in the same dimension, in proportion to their weights. With 3.5 not applicable, D3's weights become 17.6 / 35.3 / 29.4 / 17.6.

Missing tests, a failed install or a failed test run are never "not applicable". They score 0.

### Health score

```
health = min( mean(D1..D6), min(D1..D6) + 30 )
```

The six dimensions have equal weight. The cap means one very weak dimension pulls the headline down, because a codebase with no tests is not made safe by clean dependencies.

| Example | D1 | D2 | D3 | D4 | D5 | D6 | Mean | Weakest + 30 | Health |
|---|---|---|---|---|---|---|---|---|---|
| Balanced | 72 | 65 | 58 | 81 | 90 | 60 | 71.0 | 88 | **71** Stable |
| No tests | 5 | 80 | 80 | 80 | 80 | 80 | 67.5 | 35 | **35** Vibe-coded |

### Bands

| Health | Band | Meaning |
|---|---|---|
| 0–39 | Vibe-coded | Changes break things without anyone noticing. Nobody, human or agent, can work here safely. |
| 40–59 | Fragile | It works, but every change is a gamble. |
| 60–79 | Stable | Changes are safe with care and review. |
| 80–100 | Agent-ready | An agent with no memory of the codebase can make a correct change and verify it alone. |

Because of the cap, Agent-ready requires every dimension to score at least 49.5.

### Precision

Scores are stored at full precision in `run.json`. The report shows health and dimension scores as integers (rounded half up) and the health delta with one decimal. The band comes from the displayed health score.

## 3. Layers and execution

Every run has two layers.

| Layer | What it does | Parameters |
|---|---|---|
| Static | Reads tracked files, parses ASTs, builds import graphs. Never runs repository code. | 23 |
| Execution | Installs dependencies, then runs the build, the typechecker, a pinned lint ruleset and the test suite with coverage. | 7 (1.1, 1.2, 1.3, 2.1, 2.5, 6.1, 6.3) |

Both layers run on every scan. The execution layer runs in a pinned Docker image, `health:1.0`, with 4 CPUs and 8 GB of memory. The same image runs the client's code, so nothing from the repository runs on the host.

- **Network** is allowed while installing dependencies and while fetching the advisory and registry snapshots. It is off for the build, typecheck, lint and tests.
- **Environment.** Variables listed in the repository's env example file are loaded with their example values. No other variables or secrets are provided. External services such as databases, queues and browsers are not provided.
- **Timeouts.** Install 15 minutes, build 15 minutes, typecheck 10 minutes, lint 10 minutes, tests 10 minutes. The test suite runs once.

There are two kinds of failure:

| Failure | Cause | Result |
|---|---|---|
| Repository failure | Install, build, typecheck or tests fail or time out because of the repository | Every parameter that needs that step scores 0. The run is valid. |
| Tool error | The scanner itself fails, for example a crash or coverage data missing after a test run that produced results | The run is invalid and produces no score. |

## 4. Scope

Full rules are in `scope.yaml`.

- **Files.** The scan starts from `git ls-files` and keeps TypeScript, JavaScript and Python files.
- **Fixed exclusions.** Vendored code, build output, generated files, minified files, migrations and `.d.ts` files are excluded.
- **File roles.** Each remaining file is a test file, a config file or a logic file. A logic file defines at least one function, method or class. Barrels, type-only files and constants-only files are not logic files.
- **Tests.** Test files are scored in D1, and also in 2.1 (typecheck errors) and 2.5 (lint findings), because broken tests are a real problem. They are excluded from every other static metric.
- **Line counts.** *Logic lines* are non-blank, non-comment lines in logic files; Python docstrings count as comments. *Source lines* add test files. Per-1,000-line parameters use one or the other, as each parameter states.
- **`.healthignore`.** A repository can exclude more paths with gitignore syntax. The report shows the percentage of lines excluded, and `health diff` refuses to compare runs with different ignore files. `.healthignore` does not apply to the secret scan (5.4).

### Monorepos and mixed languages

A repository always gets one headline score.

- **Ratio parameters** (percentages, counts per 1,000 lines, pass rates) sum numerators and denominators across packages and languages, then score the pooled ratio once.
- **Configuration and level parameters** are scored per language or package and combined by logic-line weight. Example: 2.2 scores 100 for a TypeScript frontend with 8,000 logic lines and 0 for a Python backend with 2,000 logic lines. The pooled 2.2 score is 80.

The report breaks every dimension down per package and per language.

## 5. Comparing runs and regression flags

### The as-of date

Two parameters depend on outside data that changes over time: 5.1 (known vulnerabilities) and 5.2 (dependencies a major version behind). Every run has an **as-of date**. Advisories published on or before that date count, and "latest version" means the latest version published on or before that date.

Without this, a repository's score would drop when a new advisory is published, even if nobody changed the code.

### Delta rule

`health diff before.json after.json` compares two runs only when all five conditions match. Otherwise it refuses and names the conditions that differ.

1. **Layers.** Both runs attempted the same layers.
2. **Tool versions.** Both runs used the same image digest.
3. **Methodology version.** Both runs used the same methodology version.
4. **As-of date.** Both runs were scored at the same as-of date. In a contract, this is the baseline's as-of date. The report also shows the newer run's score as of today.
5. **Ignore set.** Both runs used the same `.healthignore` and `.gitleaksignore` contents.

`run.json` stores raw values and the resolved dependency list, so the newer run can be rescored at the baseline's as-of date without rescanning.

### Sprint-loop regression flags

Each change is scored against its base commit, at the same as-of date. Base commit runs are cached by tree hash, methodology version and as-of date.

A change is flagged when **any dimension drops by 3.0 points or more** (unrounded), or when **the band drops**. A flagged pull request gets the `health-regression` label. Flags never block a merge.

Telegram summary format:

```
Health 62 Stable (+1.4) · Safety net +6 · Complexity −1 · ⚠ none
```

## 6. The six dimensions

| # | Dimension | Question |
|---|---|---|
| D1 | Safety net | Will a change break something without anyone noticing? |
| D2 | Type & static rigor | Does the code tell you what it expects before you run it? |
| D3 | Architecture & boundaries | Can you change one part without reading the rest? |
| D4 | Complexity & maintainability | How much does someone have to read to make one change correctly? |
| D5 | Dependency & security hygiene | Is the code built on parts that are known, current and safe? |
| D6 | Operability & feedback loop | Can someone new set it up, check a change and know they are done? |

### D1. Safety net

**Question.** Will a change break something without anyone noticing?

**Why it matters for agents.** An agent cannot remember how the system is supposed to behave. The test suite is the only record of that behaviour it can check its change against.

| # | Parameter | Layer | Weight |
|---|---|---|---|
| 1.1 | Suite pass rate | Execution | 20% |
| 1.2 | Line coverage | Execution | 25% |
| 1.3 | Branch coverage | Execution | 15% |
| 1.4 | Modules with tests | Static | 25% |
| 1.5 | Tests that assert something | Static | 15% |

#### 1.1 Suite pass rate

Weight 20%. Execution layer. Scores 0 if any of these steps fail: install, test run. Pooled as a ratio across languages and packages.

**Raw value** (percent). passed / (passed + failed + errored) test cases. Skipped and expected-failure tests are excluded from both numerator and denominator. A test file that fails to load or collect counts as one failed test case.

| Raw | Score | Meaning |
|---|---|---|
| 80 | 0 | The suite is red. Nobody can use it to check a change. |
| 95 | 50 | Mostly green, with known failures people have learned to ignore. |
| 100 | 100 | Green. A new failure means the change broke something. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 0.

**How it is measured.**

- TypeScript / JavaScript: vitest, jest, mocha or node:test, detected from package.json dependencies and the test script. Run once with a JSON reporter. Playwright and Cypress suites are not run.
- Python: pytest (also runs unittest suites), with --continue-on-collection-errors and a JSON or JUnit report.

**Why.** A suite with known failures stops working as a check: a new failure looks the same as the old ones. The curve is steep on purpose. 95% of a 200-test suite is 10 failing tests, which is already enough for people to stop reading the output.

#### 1.2 Line coverage

Weight 25%. Execution layer. Scores 0 if any of these steps fail: install, test run. Pooled as a ratio across languages and packages.

**Raw value** (percent). Covered lines / coverable lines across all logic files, including logic files no test loads. A file no test loads counts as 0% covered. For TypeScript and JavaScript the coverable lines are health's code lines (lines with at least one token). A line counts as covered when the innermost statement or function containing it ran.

| Raw | Score | Meaning |
|---|---|---|
| 10 | 0 | No safety net. |
| 40 | 50 | Happy paths only. |
| 60 | 75 | Acceptable. |
| 80 | 100 | Well covered. No extra credit above this. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 0.

**How it is measured.**

- TypeScript / JavaScript: v8 or istanbul coverage with the json-summary and json reporters (vitest coverage.include, jest collectCoverageFrom over logic files, c8 for mocha and node:test). Lines are counted by health from the json report's statement and function ranges, not taken from the tool, so the same code gives the same count under every runner. Repository coverage thresholds are disabled so they cannot fail the run.
- Python: coverage.py through pytest-cov, with --cov set to every first-party package so files no test imports are included.

**Why.** Coverage shows which code no test executes. It does not show that the executed code is checked, which is why 1.5 exists. The 60% anchor matches Google's "acceptable" level. The 100 anchor is 80%, which is the coverage SonarQube's default quality gate requires on new code and sits between Google's "commendable" (75%) and "exemplary" (90%). Above 80% the methodology gives no extra credit, because the remaining code is often glue that costs more to test than it returns.

**Sources.**

- Arguelles, Ivanković, Bender. Code Coverage Best Practices. Google Testing Blog, 2020. https://testing.googleblog.com/2020/08/code-coverage-best-practices.html
- SonarQube default quality gate (Sonar way): coverage on new code at least 80%.

#### 1.3 Branch coverage

Weight 15%. Execution layer. Scores 0 if any of these steps fail: install, test run. Pooled as a ratio across languages and packages.

**Raw value** (percent). Covered branches / total branches across all logic files, including files no test loads.

| Raw | Score | Meaning |
|---|---|---|
| 5 | 0 | Only one path through each decision is ever run. |
| 30 | 50 | Error and edge paths are mostly untested. |
| 50 | 75 | Main error paths are tested. |
| 70 | 100 | Most decisions are tested both ways. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 0.

**How it is measured.**

- TypeScript / JavaScript: Same coverage run as 1.2; branch totals from json-summary. They come from the runner's coverage tool and can differ slightly between runners on the same code.
- Python: Same run as 1.2 with --cov-branch.

**Why.** Tests written quickly cover the happy path. Line coverage can be high while every error branch is untested. Branch coverage shows that gap. Branch percentages are lower than line percentages on the same code, so the anchors sit about 10 points lower than 1.2's.

#### 1.4 Modules with tests

Weight 25%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (percent). Logic files directly imported by at least one test file / all logic files. Imports are followed through barrel files and Python __init__.py re-exports to the file that defines the imported name. Transitive imports do not count.

| Raw | Score | Meaning |
|---|---|---|
| 10 | 0 | Almost nothing has a test. |
| 40 | 50 | Some modules have tests; most do not. |
| 70 | 75 | Most modules have a test. |
| 90 | 100 | Nearly every module has a test. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 0.

**How it is measured.**

- TypeScript / JavaScript: AST import graph from test files (static imports, require and dynamic import with a literal path).
- Python: AST import graph from test files (import and from-import statements).

**Why.** This is the static counterpart to coverage. It still works when the suite does not run, so a repository with tests that are broken gets partial credit, and "make the existing tests run" shows up as a gain in 1.1 to 1.3. Only direct imports count; otherwise one test that imports the app entry point would mark every file as tested.

#### 1.5 Tests that assert something

Weight 15%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (percent). Test cases containing at least one assertion / all test cases. An assertion inside a helper function defined in the same file and called by the test counts (one level deep).

| Raw | Score | Meaning |
|---|---|---|
| 50 | 0 | Many tests run code without checking anything. |
| 80 | 50 | A noticeable share of tests check nothing. |
| 95 | 75 | A few tests check nothing. |
| 100 | 100 | Every test checks something. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 0.

**How it is measured.**

- TypeScript / JavaScript: Test case: a call to it, test or their .each/.only/.concurrent variants. Assertion: expect(...), assert(...), assert.*, expectTypeOf(...), t.assert* / t.is / t.deepEqual (node:test and ava contexts).
- Python: Test case: a test_* function in a test module, or a test_* method of a unittest.TestCase subclass. Assertion: an assert statement, self.assert*, pytest.raises, pytest.warns, or a mock method call starting with assert_.

**Why.** A test without an assertion raises coverage and checks nothing. This is the cheapest way to game 1.2 and 1.3, and it is common in generated tests. The anchors are strict because writing a test without an assertion is almost never intentional.

### D2. Type & static rigor

**Question.** Does the code tell you what it expects before you run it?

**Why it matters for agents.** Type errors and lint findings are the fastest feedback an agent gets. A strict typechecker catches a wrong change in seconds, before any test runs, and the types document what each function accepts and returns.

| # | Parameter | Layer | Weight |
|---|---|---|---|
| 2.1 | Typecheck errors | Execution | 25% |
| 2.2 | Declared strictness | Static | 20% |
| 2.3 | Escape hatches | Static | 20% |
| 2.4 | Typed public surface | Static | 15% |
| 2.5 | Baseline lint findings | Execution | 20% |

#### 2.1 Typecheck errors

Weight 25%. Execution layer. Scores 0 if any of these steps fail: install, typecheck run. Pooled as a ratio across languages and packages.

**Raw value** (errors per 1,000 source lines). Typechecker errors located in in-scope files (logic and test), divided by source lines / 1,000. Errors in excluded files and in dependencies are ignored. Warnings are ignored.

| Raw | Score | Meaning |
|---|---|---|
| 0 | 100 | Clean. A new error means the change introduced it. |
| 1 | 75 | A few known errors. |
| 5 | 50 | Errors are routine and people work around them. |
| 20 | 0 | The typechecker is ignored. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: tsc --noEmit with the repository's tsconfig.json (each tsconfig that a workspace package declares). JavaScript-only repositories without a tsconfig or jsconfig are checked with a default config: allowJs, checkJs, strict false.
- Python: pyright with the repository's configuration (pyrightconfig.json or [tool.pyright]). If only mypy is configured, mypy with its configuration. If both are configured, pyright. If neither, pyright in basic mode.

**Why.** The repository's own config is used so the count reflects what its developers see. A config error, or a checker that cannot start, is a repository failure and scores 0. Untyped code is checked with a default config on purpose, so "add types" is visible as a score change.

**Sources.**

- TypeScript: Type checking JavaScript files (checkJs). https://www.typescriptlang.org/docs/handbook/type-checking-javascript-files.html
- Pyright configuration: typeCheckingMode. https://microsoft.github.io/pyright/#/configuration

#### 2.2 Declared strictness

Weight 20%. Static layer. Scored per language and package, then combined by logic-line weight.

**Raw value** (level). The strictness the repository's typechecker configuration declares, read from the config files without running anything.

TypeScript / JavaScript:

| Level | Score | Meaning |
|---|---|---|
| none | 0 | No strict-family flag is enabled, or JavaScript without checkJs. |
| partial | 40 | Some strict-family flags are enabled, or strict is true with one or more strict-family flags turned back off. |
| strict | 75 | strict is true and no strict-family flag is turned off. |
| strict_plus | 100 | strict plus noUncheckedIndexedAccess. |

Python:

| Level | Score | Meaning |
|---|---|---|
| none | 0 | No pyright or mypy configuration. |
| basic | 40 | pyright typeCheckingMode basic, or mypy with default settings. |
| standard | 75 | pyright typeCheckingMode standard (pyright's default when a config exists), or mypy with disallow_untyped_defs and check_untyped_defs. |
| strict | 100 | pyright typeCheckingMode strict, or mypy strict = true. |

**How it is measured.**

- TypeScript / JavaScript: tsconfig.json with extends resolved. Strict-family flags: noImplicitAny, strictNullChecks, strictFunctionTypes, strictBindCallApply, strictPropertyInitialization, noImplicitThis, useUnknownInCatchVariables, alwaysStrict.
- Python: pyrightconfig.json, [tool.pyright] or [tool.basedpyright] in pyproject.toml; mypy.ini, .mypy.ini, setup.cfg [mypy] or [tool.mypy] in pyproject.toml. When both are configured, pyright's level is used.

**Why.** 2.1 counts errors under whatever config the repository chose. Without 2.2, turning strictness off would raise the score. Strict null checks catch access to null and undefined values, a common runtime error in both languages. noUncheckedIndexedAccess makes array and record lookups return possibly undefined values, which is where strict TypeScript still lets runtime errors through.

**Sources.**

- TypeScript TSConfig reference: strict. https://www.typescriptlang.org/tsconfig#strict
- TypeScript TSConfig reference: noUncheckedIndexedAccess. https://www.typescriptlang.org/tsconfig#noUncheckedIndexedAccess
- Pyright configuration: typeCheckingMode. https://microsoft.github.io/pyright/#/configuration
- mypy command line: --strict. https://mypy.readthedocs.io/en/stable/command_line.html

#### 2.3 Escape hatches

Weight 20%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (escape hatches per 1,000 logic lines). Points where code opts out of the typechecker, counted in logic files, divided by logic lines / 1,000. A file-level opt-out counts as 10.

| Raw | Score | Meaning |
|---|---|---|
| 0 | 100 | The types are trusted everywhere. |
| 2 | 75 | A few documented exceptions. |
| 5 | 50 | Casts are a common way to make errors go away. |
| 15 | 0 | The types say little about what the code does. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: Each counts 1: an explicit any type; an as assertion (as const is excluded; each as in "as unknown as T" counts separately); an angle-bracket assertion <T>x; a non-null assertion x!; a definite assignment assertion x!: T; @ts-ignore; @ts-expect-error. Counts 10: @ts-nocheck.
- Python: Each counts 1: Any in an annotation; typing.cast(...); # type: ignore on a line; # pyright: ignore on a line. Counts 10: # type: ignore before the first statement of a module; # mypy: ignore-errors.

**Why.** Each escape hatch is a place where the typechecker cannot help the next person. A change that breaks a contract passes the typechecker silently at that point. The typescript-eslint no-unsafe-* rules are not used in 2.5, so the same problem is not counted twice.

#### 2.4 Typed public surface

Weight 15%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (percent). Typed slots / all slots on the public surface of logic files. In TypeScript and JavaScript a slot is a parameter. In Python a slot is a parameter or a return type.

| Raw | Score | Meaning |
|---|---|---|
| 20 | 0 | The public surface is untyped. |
| 50 | 50 | Half of what callers use is typed. |
| 80 | 75 | Most of what callers use is typed. |
| 100 | 100 | Every public function says what it accepts. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: Public surface: exported functions, exported arrow functions and function expressions, default exports, and public methods of exported classes. A parameter is typed if it has a type annotation, a default value, a contextual type (for example a callback passed to a typed function), or a JSDoc @param type in a file checked with checkJs.
- Python: Public surface: module-level functions and classes whose names do not start with _, and their methods whose names do not start with _ (dunder methods are included). If __all__ is defined, it decides what is public. Modules whose names start with _ are excluded. self and cls are not slots. __init__ needs no return annotation.

**Why.** The public surface is what the next person calls without reading the body. In TypeScript, inferred return types are reliable, so only parameters are counted. In Python, an unannotated return is Any, so both are counted. Untyped JavaScript and untyped Python score low on purpose.

**Sources.**

- PEP 484: Type Hints. https://peps.python.org/pep-0484/

#### 2.5 Baseline lint findings

Weight 20%. Execution layer. Scores 0 if any of these steps fail: install, lint run. Pooled as a ratio across languages and packages.

**Raw value** (findings per 1,000 source lines). Findings from the methodology's pinned correctness ruleset in in-scope files (logic and test), divided by source lines / 1,000. The repository's own lint config is not used. A file that cannot be parsed counts as one finding.

| Raw | Score | Meaning |
|---|---|---|
| 0 | 100 | No known bug patterns. |
| 2 | 75 | A few. |
| 5 | 50 | Bug patterns are common. |
| 20 | 0 | The code has never been linted for correctness. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: ESLint with the pinned ruleset. Core rules: no-unreachable, no-dupe-keys, no-self-compare, no-unsafe-finally, no-fallthrough, no-cond-assign, use-isnan, valid-typeof, no-unsafe-optional-chaining, no-dupe-else-if, no-duplicate-case, no-self-assign, getter-return, no-async-promise-executor, no-constant-binary-expression, no-unused-vars (or @typescript-eslint/no-unused-vars on TypeScript files). Type-aware rules on TypeScript files only: @typescript-eslint/no-floating-promises, no-misused-promises, await-thenable. TypeScript files outside every tsconfig are linted without the type-aware rules. react-hooks/rules-of-hooks when react is a dependency.
- Python: ruff with the rule sets F (Pyflakes), B (flake8-bugbear) and E9 (syntax and IO errors).

**Why.** Each rule in the set catches a real bug pattern, such as an unawaited promise or an unreachable branch. Style rules are excluded, so formatting choices do not affect the score. The ruleset is pinned so every repository is judged by the same rules, and so turning rules off in the repository's own config does not raise the score.

**Sources.**

- typescript-eslint rules. https://typescript-eslint.io/rules/
- Ruff rules. https://docs.astral.sh/ruff/rules/

### D3. Architecture & boundaries

**Question.** Can you change one part without reading the rest?

**Why it matters for agents.** An agent works inside a limited context window. Enforced boundaries limit how much of the codebase one change can affect, so the agent only needs to read the module it is changing and that module's public entry points.

| # | Parameter | Layer | Weight |
|---|---|---|---|
| 3.1 | Boundaries declared and enforced | Static | 15% |
| 3.2 | Boundary violations | Static | 30% |
| 3.3 | Import cycles | Static | 25% |
| 3.4 | Public-entry discipline | Static | 15% |
| 3.5 | Domain purity | Static | 15% |

**Presets.** When a repository declares no import rules, the scan uses the preset for the detected framework (presets/*.yaml). When it declares rules (see 3.1), its rules replace the preset. Detection order: nextjs, express, django, fastapi, generic. Each workspace package gets its own preset.

#### 3.1 Boundaries declared and enforced

Weight 15%. Static layer. Scored per language and package, then combined by logic-line weight.

**Raw value** (level). Whether the repository declares import rules in a supported rules file, and whether CI runs them.

| Level | Score | Meaning |
|---|---|---|
| none | 0 | No import rules are declared. |
| declared | 50 | A rules file declares at least one direction rule, but CI does not run it. |
| enforced | 100 | The rules are declared and CI runs them on pull requests. |

**How it is measured.**

- TypeScript / JavaScript: Rules file: .dependency-cruiser.{js,cjs,mjs,json}. Declared means at least one forbidden or allowed rule whose from and to paths name different directories. Enforced means a CI file invokes depcruise, directly or through a package script or make target (up to 3 levels).
- Python: Rules file: .importlinter, [importlinter] in setup.cfg, or [tool.importlinter] in pyproject.toml. Declared means at least one layers, forbidden or independence contract. Enforced means a CI file invokes lint-imports, directly or through a script or make target.
- Ci files: .github/workflows/*, .gitlab-ci.yml, .circleci/config.yml, bitbucket-pipelines.yml, azure-pipelines.yml.

**Why.** An architecture that exists only in people's heads is not visible to an agent and erodes with each change. A rules file states the architecture in a form a tool can check. Running it in CI is what stops new violations.

**Sources.**

- dependency-cruiser rules reference. https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
- import-linter contract types. https://import-linter.readthedocs.io/en/stable/contract_types.html

#### 3.2 Boundary violations

Weight 30%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (violations per 1,000 imports). Import edges that break a rule, divided by all internal import edges / 1,000. Rules come from the repository's declared rules file, or from the preset when none is declared. Rules with severity error or warn count; info is ignored. Each violating edge counts once, even when it breaks several rules. Imports from test files are excluded. Type-only imports are included, except where a preset rule says otherwise.

| Raw | Score | Meaning |
|---|---|---|
| 0 | 100 | Every import respects the architecture. |
| 2 | 75 | A few known shortcuts. |
| 10 | 50 | The layers exist in name only in places. |
| 30 | 0 | Anything imports anything. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: dependency-cruiser with the declared rules or the preset converted to dependency-cruiser rules.
- Python: grimp builds the import graph; import-linter checks the declared contracts or the preset converted to contracts.

**Why.** Each violation is a dependency a reader would not expect from the directory structure. The count is normalized per 1,000 imports so repositories of different sizes are comparable.

**Sources.**

- Martin, R. C. Clean Architecture. Prentice Hall, 2017 (the Dependency Rule).
- Cockburn, A. Hexagonal Architecture (Ports and Adapters), 2005. https://alistair.cockburn.us/hexagonal-architecture/

#### 3.3 Import cycles

Weight 25%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (percent). Logic files that belong to an import cycle / all logic files. A cycle is a strongly connected component of two or more files in the graph of module-level static imports. Type-only imports, dynamic imports, imports inside functions and imports under "if TYPE_CHECKING:" are excluded.

| Raw | Score | Meaning |
|---|---|---|
| 0 | 100 | The import graph has no cycles. |
| 2 | 75 | One or two small cycles. |
| 5 | 50 | Cycles connect several areas. |
| 15 | 0 | Large parts of the code depend on each other. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: dependency-cruiser cycle detection on the filtered graph.
- Python: grimp import graph, filtered as defined, then strongly connected components.

**Why.** Files in a cycle cannot be understood, tested or changed one at a time. Cycles also cause import-order bugs at runtime, especially in Python. Type-only imports are excluded because they have no runtime effect.

**Sources.**

- Martin, R. C. Agile Software Development: Principles, Patterns, and Practices. Prentice Hall, 2002 (the Acyclic Dependencies Principle).

#### 3.4 Public-entry discipline

Weight 15%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (percent). Imports that cross from one module into another and land on that module's public entry / all imports that cross between modules. Modules are defined by the preset (or by the independence or layer contracts in the declared rules). The public entry is index.* in TypeScript and JavaScript, and __init__.py in Python.

| Raw | Score | Meaning |
|---|---|---|
| 50 | 0 | Other modules reach into internals as often as not. |
| 75 | 50 | Entry points exist and are often bypassed. |
| 90 | 75 | Entry points are mostly used. |
| 100 | 100 | Every cross-module import goes through the entry point. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: Import graph from dependency-cruiser; module roots from the preset.
- Python: grimp import graph; module roots from the preset. In Django apps, models, services and selectors are also public entries.

**Not applicable when.** The repository has fewer than two modules as defined by the preset or the declared rules. Splitting code into modules is a design choice the methodology does not score.

**Why.** A public entry point is a small interface the next person can read instead of the whole module. When other modules import internals directly, every internal file becomes part of the interface and cannot be changed safely.

**Sources.**

- HackSoft Django Styleguide. https://github.com/HackSoftware/Django-Styleguide

#### 3.5 Domain purity

Weight 15%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (percent). Files in the domain layer that import a framework, database, network or filesystem package, or an infrastructure directory / all files in the domain layer.

| Raw | Score | Meaning |
|---|---|---|
| 0 | 100 | Domain logic is plain code that runs and tests without infrastructure. |
| 5 | 75 | A few domain files touch infrastructure. |
| 15 | 50 | Domain logic regularly reaches for the database or the network. |
| 40 | 0 | The domain layer is a directory name. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- Domain layer: Files under a directory named domain, or files in a layer named domain in the declared rules.
- TypeScript / JavaScript: Forbidden imports: next, react, react-dom, express, @prisma/client, drizzle-orm, pg, mysql2, mongoose, redis, ioredis, axios, node-fetch, fs, node:fs, http, node:http, https, node:https. A call to the global fetch also counts.
- Python: Forbidden imports: django, fastapi, flask, starlette, sqlalchemy, requests, httpx, aiohttp, boto3, psycopg, psycopg2, redis, pymongo. A call to the builtin open also counts.
- Infrastructure directories: infrastructure, infra, db, adapters.

**Not applicable when.** The repository declares no domain layer. Choosing a layered or domain-driven design is a design choice the methodology does not score.

**Why.** This is the deterministic part of domain-driven design alignment. Pure domain code can be tested without a database or network and changed without reading infrastructure code. The methodology does not judge whether the domain model is good; it checks that the repository keeps the boundary it declared.

**Sources.**

- Evans, E. Domain-Driven Design. Addison-Wesley, 2003.
- Cockburn, A. Hexagonal Architecture (Ports and Adapters), 2005. https://alistair.cockburn.us/hexagonal-architecture/

### D4. Complexity & maintainability

**Question.** How much does someone have to read to make one change correctly?

**Why it matters for agents.** Every line an agent reads uses context. Long files, complex functions, duplicated logic and dead code all increase how much it must read, and duplicated logic is where an agent fixes one copy and misses the other.

| # | Parameter | Layer | Weight |
|---|---|---|---|
| 4.1 | Complex functions | Static | 30% |
| 4.2 | Lines in large files | Static | 20% |
| 4.3 | Duplication | Static | 25% |
| 4.4 | Unused exports and files | Static | 25% |

#### 4.1 Complex functions

Weight 30%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (percent). Functions with cognitive complexity strictly greater than 15 / all functions in logic files, as enumerated by the tool.

| Raw | Score | Meaning |
|---|---|---|
| 0 | 100 | Every function can be read in one pass. |
| 3 | 75 | A few hard functions. |
| 8 | 50 | Hard functions in most areas. |
| 20 | 0 | Logic is concentrated in functions nobody wants to touch. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: eslint-plugin-sonarjs cognitive-complexity rule, threshold 15.
- Python: complexipy, threshold 15.

**Why.** Cognitive complexity counts nesting and breaks in linear flow, which is closer to how hard a function is to read than cyclomatic complexity. 15 is the default threshold in SonarQube, eslint-plugin-sonarjs and complexipy. Counting the share of functions over the threshold, instead of the mean, keeps many small functions from hiding a few large ones.

**Sources.**

- Campbell, G. A. Cognitive Complexity: A new way of measuring understandability. SonarSource, 2018. https://www.sonarsource.com/docs/CognitiveComplexity.pdf
- SonarQube rule S3776 (Cognitive Complexity of functions should not be too high), default threshold 15.
- McCabe, T. J. A Complexity Measure. IEEE Transactions on Software Engineering, 1976 (cyclomatic complexity, threshold 10).

#### 4.2 Lines in large files

Weight 20%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (percent). Logic lines in logic files with more than 500 logic lines / all logic lines.

| Raw | Score | Meaning |
|---|---|---|
| 0 | 100 | Every file fits in one read. |
| 10 | 75 | A few large files. |
| 25 | 50 | A quarter of the code lives in large files. |
| 50 | 0 | Most of the code lives in files too large to read whole. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: Logic line count per file (scope.yaml).
- Python: Logic line count per file (scope.yaml); docstrings do not count.

**Why.** A large file has to be read in parts, so changes to it are made with partial context. The threshold of 500 logic lines is more lenient than ESLint's max-lines default (300 physical lines) and stricter than Pylint's max-module-lines default (1,000). The raw value is a share of lines, not of files, so one 5,000-line file weighs more than one 501-line file.

**Sources.**

- ESLint max-lines rule, default 300. https://eslint.org/docs/latest/rules/max-lines
- Pylint too-many-lines (C0302), max-module-lines default 1000.

#### 4.3 Duplication

Weight 25%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (percent). Duplicated lines / all lines in logic files, as reported by jscpd.

| Raw | Score | Meaning |
|---|---|---|
| 3 | 100 | Duplication is incidental. |
| 5 | 75 | Some copied blocks. |
| 10 | 50 | Copy and paste is a common way to add features. |
| 20 | 0 | Large parts of the logic exist in several copies. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: jscpd, min-tokens 50, min-lines 5, logic files only.
- Python: jscpd, same settings.

**Why.** A bug fixed in one copy stays in the others. This is a common agent mistake: the agent finds one copy, fixes it, and its tests pass. 3% is the default duplication limit in SonarQube's quality gate.

**Sources.**

- SonarQube default quality gate (Sonar way): duplicated lines on new code at most 3%.
- jscpd. https://github.com/kucherenko/jscpd

#### 4.4 Unused exports and files

Weight 25%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (percent). (Unused exported symbols + exported symbols in unused files) / all exported symbols in logic files. Exported types count. Library entry points (package.json exports and main, Python __all__ of a distributed package) count as used.

| Raw | Score | Meaning |
|---|---|---|
| 0 | 100 | Everything exported is used. |
| 3 | 75 | A little dead code. |
| 8 | 50 | Dead code is common. |
| 20 | 0 | A large share of the code is never called. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: knip (unused files, exports and types), with framework plugins enabled.
- Python: vulture with min-confidence 60 for unused functions, classes and methods; decorated definitions are treated as used. Unused modules: modules no other module imports, excluding entry modules (__main__, manage.py, wsgi, asgi, settings, conftest, targets of [project.scripts], Django convention modules such as models, admin, apps, urls, views, and FastAPI main.py).

**Why.** Dead code costs reading time and looks like a place to make a change. An agent that edits an unused function gets no test failure and no effect. Decorated Python definitions are treated as used because frameworks register them by decorator (routes, fixtures, signals).

**Sources.**

- knip. https://knip.dev
- vulture. https://github.com/jendrikseipp/vulture

### D5. Dependency & security hygiene

**Question.** Is the code built on parts that are known, current and safe?

**Why it matters for agents.** An agent adds dependencies and copies patterns from what it finds. An undeclared dependency, a stale major version or a committed secret gets copied into new code the same way good patterns do.

| # | Parameter | Layer | Weight |
|---|---|---|---|
| 5.1 | Known vulnerabilities in production dependencies | Static | 30% |
| 5.2 | Dependencies a major version behind | Static | 20% |
| 5.3 | Lockfile | Static | 15% |
| 5.4 | Secrets in the working tree | Static | 20% |
| 5.5 | Dependency declaration errors | Static | 15% |

**As of date.** Parameters 5.1 and 5.2 are evaluated at the run's as-of date: advisories published on or before that date count, and the latest version of a package is the latest published on or before that date.

#### 5.1 Known vulnerabilities in production dependencies

Weight 30%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (severity points). Sum of severity points over advisories affecting resolved production dependencies (direct and transitive). Critical 10, high 5, moderate 2, low 0.5. Each advisory counts once per package; aliases are deduplicated. Withdrawn advisories are excluded.

| Raw | Score | Meaning |
|---|---|---|
| 0 | 100 | No known vulnerabilities. |
| 2 | 75 | One moderate, or a few low. |
| 10 | 50 | A critical, or several highs. |
| 30 | 0 | Several criticals. Nobody is watching. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: osv-scanner on the lockfile, against the OSV snapshot for the as-of date. Production dependencies only.
- Python: osv-scanner on the lockfile, against the OSV snapshot for the as-of date. Production dependencies only.
- Severity: The GitHub Security Advisory severity label when present. Otherwise the CVSS v3.1 base score band (critical 9.0-10.0, high 7.0-8.9, moderate 4.0-6.9, low 0.1-3.9). Otherwise moderate.

**Why.** Severity points stop one critical advisory from scoring the same as one low one. The count is not normalized by repository size, because a vulnerability's risk does not shrink as the codebase grows. Development-only dependencies are reported separately and not scored.

**Sources.**

- OSV schema (published, withdrawn, aliases). https://ossf.github.io/osv-schema/
- FIRST. CVSS v3.1 Specification, qualitative severity rating scale. https://www.first.org/cvss/v3.1/specification-document

#### 5.2 Dependencies a major version behind

Weight 20%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (percent). Direct dependencies (production and development) whose resolved version is at least one major version behind the highest stable, non-yanked version published on or before the as-of date / all direct dependencies. For 0.x versions, a minor version bump counts as major.

| Raw | Score | Meaning |
|---|---|---|
| 0 | 100 | Every direct dependency is on its current major. |
| 10 | 75 | A few dependencies are behind. |
| 25 | 50 | A quarter of dependencies are behind. |
| 50 | 0 | Upgrades have stopped. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: npm registry publish times from the registry snapshot.
- Python: PyPI release upload times from the registry snapshot.

**Why.** Each major version behind is a migration someone will have to do, and an agent writing code against current documentation will use APIs the installed version does not have. Development dependencies are included because outdated tooling affects every change.

**Sources.**

- Semantic Versioning 2.0.0, item 4 (major version zero). https://semver.org

#### 5.3 Lockfile

Weight 15%. Static layer. Scored per language and package, then combined by logic-line weight.

**Raw value** (level). Whether a lockfile exists and matches the manifest.

| Level | Score | Meaning |
|---|---|---|
| none | 0 | No lockfile. Every install can resolve different versions. |
| out_of_sync | 40 | A lockfile exists but does not match the manifest. |
| in_sync | 100 | The lockfile matches the manifest. |

**How it is measured.**

- TypeScript / JavaScript: package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml, yarn.lock or bun.lock. In sync means every dependency declared in package.json is present in the lockfile with a version that satisfies its range.
- Python: uv.lock, poetry.lock, pdm.lock, Pipfile.lock, or requirements files with every requirement pinned with == and --hash. In sync means every dependency declared in pyproject.toml (or Pipfile) is in the lockfile with a version that satisfies its specifier, or for uv.lock and poetry.lock, the lockfile's recorded manifest hash matches.

**Why.** Without a lockfile, two installs of the same commit can produce different code. Results stop being reproducible, including this methodology's results.

**Sources.**

- npm ci documentation. https://docs.npmjs.com/cli/commands/npm-ci

#### 5.4 Secrets in the working tree

Weight 20%. Static layer. Scored per language and package, then combined by logic-line weight.

**Raw value** (count). Secrets found by the pinned gitleaks default ruleset in every tracked file at the scanned commit. .healthignore does not apply. .gitleaksignore applies and is part of the ignore set.

| Raw | Score | Meaning |
|---|---|---|
| 0 | 100 | No secrets in the code. |
| 1 | 0 | At least one secret is in the code. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- All languages: gitleaks dir on the checkout, default ruleset of the pinned version.

**Why.** One committed secret is enough to cause a breach, so the parameter is binary. Secrets in git history are reported but not scored, because the fix is rotating the key, which cannot be seen in the code.

**Sources.**

- CWE-798: Use of Hard-coded Credentials. https://cwe.mitre.org/data/definitions/798.html
- gitleaks. https://github.com/gitleaks/gitleaks

#### 5.5 Dependency declaration errors

Weight 15%. Static layer. Pooled as a ratio across languages and packages.

**Raw value** (percent). (Declared dependencies that are never imported + imported packages that are not declared) / declared direct dependencies.

| Raw | Score | Meaning |
|---|---|---|
| 0 | 100 | The manifest matches the code. |
| 5 | 75 | A few stale or missing entries. |
| 15 | 50 | The manifest and the code have drifted apart. |
| 30 | 0 | Nobody maintains the manifest. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 100.

**How it is measured.**

- TypeScript / JavaScript: knip unused dependencies plus unlisted dependencies.
- Python: deptry DEP001 (missing), DEP002 (unused) and DEP003 (transitive imported directly). DEP004 (development dependency used in production code) is not counted.

**Why.** An undeclared import works until the transitive dependency that provides it changes. An unused declaration adds install time and attack surface. Both mislead a reader about what the code depends on.

**Sources.**

- deptry rules. https://deptry.com/rules-violations/

### D6. Operability & feedback loop

**Question.** Can someone new set it up, check a change and know they are done?

**Why it matters for agents.** An agent needs a command that tells it whether its change is correct, and it needs to find that command without asking. A slow or missing check means the agent stops early or guesses.

| # | Parameter | Layer | Weight |
|---|---|---|---|
| 6.1 | Clean install and build | Execution | 25% |
| 6.2 | One-command verify | Static | 15% |
| 6.3 | Feedback loop time | Execution | 10% |
| 6.4 | CI runs the checks on pull requests | Static | 20% |
| 6.5 | Reproducible environment | Static | 15% |
| 6.6 | Commands documented for agents | Static | 15% |

**Script resolution.** Parameters 6.2, 6.4 and 6.6 follow package.json scripts, Makefile targets, justfile recipes, tox and nox sessions, and pyproject.toml script tables up to 3 levels deep. Recognised tools: typecheckers tsc, vue-tsc, pyright, basedpyright, mypy; linters eslint, biome, oxlint, ruff, flake8, pylint; test runners vitest, jest, mocha, node --test, pytest, python -m unittest, tox, nox. The prefixes npx, bunx, pnpm exec, yarn, uv run, poetry run, pdm run and python -m are removed before a command is matched.

#### 6.1 Clean install and build

Weight 25%. Execution layer. Scored per language and package, then combined by logic-line weight.

**Raw value** (level). Result of a clean install from the lockfile, followed by the build step, in the pinned runner.

| Level | Score | Meaning |
|---|---|---|
| install_fails | 0 | The project does not install from a clean checkout. |
| build_fails | 40 | It installs, but the build fails. |
| works | 100 | It installs and builds from a clean checkout. A project with no build step scores 100 when the install succeeds. |

**How it is measured.**

- TypeScript / JavaScript: Install: npm ci, pnpm install --frozen-lockfile, yarn install --immutable or bun install --frozen-lockfile, chosen by lockfile; npm install when there is no lockfile. Build: the build script in package.json, when one exists.
- Python: Install: uv sync --frozen, poetry install --sync, pdm sync, pipenv sync, or pip install -r on the requirements files, chosen by lockfile; pip install . when there is only a pyproject.toml. Build: python manage.py check for Django projects; otherwise importing each first-party top-level package.

**Why.** Everything in the execution layer depends on this step. A project that does not install from a clean checkout depends on someone's machine.

#### 6.2 One-command verify

Weight 15%. Static layer. Scored per language and package, then combined by logic-line weight.

**Raw value** (count of checks (0-3)). The largest number of the three checks (typecheck, lint, tests) that a single entry point runs: one package.json script, Makefile target, justfile recipe, tox or nox session, or pyproject script.

| Level | Score | Meaning |
|---|---|---|
| 0 | 0 | No single command runs any check. |
| 1 | 33 | One command runs one check. |
| 2 | 66 | One command runs two checks. |
| 3 | 100 | One command runs typecheck, lint and tests. |

**How it is measured.**

- All languages: Static resolution of entry points as described in script_resolution.

**Why.** "Run this and it tells you if you are done" is the most useful fact an agent can learn about a repository. Without it, the agent has to find and run each check separately, and often skips one.

#### 6.3 Feedback loop time

Weight 10%. Execution layer. Scores 0 if any of these steps fail: install, typecheck run, lint run, test run. Scored per language and package, then combined by logic-line weight.

**Raw value** (seconds). Summed wall-clock time of the methodology's own typecheck (2.1), lint (2.5) and test (1.1) runs on the pinned runner.

| Raw | Score | Meaning |
|---|---|---|
| 60 | 100 | A full check takes about a minute. |
| 180 | 75 | A full check takes a few minutes. |
| 600 | 50 | The ten-minute build. |
| 1200 | 0 | Nobody runs the full check locally. |

Scores are interpolated between anchors and clamped outside them. If there is nothing to count, the score is 0.

**How it is measured.**

- All languages: Wall-clock time recorded by the orchestrator for the three steps.

**Why.** A slow check gets run less often, by people and by agents. This is the only parameter whose raw value varies between identical runs, so its weight is low and the runner hardware is fixed.

**Sources.**

- Beck, K. Extreme Programming Explained, 2nd ed. Addison-Wesley, 2004 (Ten-Minute Build).
- Fowler, M. Continuous Integration. https://martinfowler.com/articles/continuousIntegration.html

#### 6.4 CI runs the checks on pull requests

Weight 20%. Static layer. Scored per language and package, then combined by logic-line weight.

**Raw value** (count of checks (0-3)). How many of the three checks (typecheck, lint, tests) CI runs on pull requests or on every push. Checks may be spread across jobs and workflows.

| Level | Score | Meaning |
|---|---|---|
| 0 | 0 | CI runs no checks, or there is no CI. |
| 1 | 33 | CI runs one check. |
| 2 | 66 | CI runs two checks. |
| 3 | 100 | CI runs typecheck, lint and tests on every pull request. |

**How it is measured.**

- All languages: CI files as listed in 3.1. A workflow counts if it is triggered on pull_request, pull_request_target, merge_request events, or on push without a branch filter that limits it to the default branch. Commands are resolved as described in script_resolution.

**Why.** Local checks are optional; CI checks are not. CI is what keeps the score from dropping after the audit ends.

**Sources.**

- Fowler, M. Continuous Integration. https://martinfowler.com/articles/continuousIntegration.html

#### 6.5 Reproducible environment

Weight 15%. Static layer. Scored per language and package, then combined by logic-line weight.

**Raw value** (score). Mean of two components.

The score is the mean of two components, each 0-100:

- **Runtime version pinned**: 100 if pinned, 0 if not. Counts: Any of .nvmrc, .node-version, .tool-versions, mise.toml, engines.node in package.json, volta in package.json, .python-version, requires-python in pyproject.toml, or runtime.txt.
- **Environment variables documented**: Variable names read in logic files that appear in an env example file / all variable names read in logic files, times 100. No variables read scores 100. Example files: .env.example, .env.sample, .env.template, .env.dist, example.env. Reads: process.env.X, process.env["X"], destructuring from process.env, import.meta.env.X, os.environ["X"], os.environ.get("X"), os.getenv("X"). Excluded names: NODE_ENV, CI, HOME, PATH, PWD, TZ, NEXT_RUNTIME, and names starting with VERCEL_, NETLIFY, RENDER_, RAILWAY_ or GITHUB_.

**How it is measured.**

- All languages: Static reads of the files and patterns listed in the components.

**Why.** A missing environment variable is a common reason a fresh checkout does not start, and an agent cannot guess the names. Config read from the environment, with the names documented, is the Twelve-Factor approach.

**Sources.**

- The Twelve-Factor App, III. Config. https://12factor.net/config

#### 6.6 Commands documented for agents

Weight 15%. Static layer. Scored per language and package, then combined by logic-line weight.

**Raw value** (level). Whether the repository documents how to install, run and check it, and whether the documented commands exist.

| Level | Score | Meaning |
|---|---|---|
| none | 0 | No documented commands. |
| readme | 50 | README documents commands, or an agent instructions file exists but at least one command in it does not resolve. |
| agent_file | 100 | AGENTS.md or CLAUDE.md at the repository root documents commands, and every command in it resolves. |

**How it is measured.**

- All languages: A command is an inline code span or a line in a fenced code block that starts with a package manager (npm, pnpm, yarn, bun, npx, uv, poetry, pdm, pip, pipenv, python, make, just) or a recognised tool. It resolves when the script, target, recipe, session or tool it names exists in the repository or in its declared dependencies.

**Why.** An agent reads AGENTS.md or CLAUDE.md before anything else. Commands in that file that do not exist send it down the wrong path, which is worse than no file, so they drop the level to README.

**Sources.**

- AGENTS.md. https://agents.md

## 7. Report-only signals

These appear in the report and never change the score.

| Signal | What it shows | Why it is not scored |
|---|---|---|
| Hotspots | Files ranked by churn (commits in the last 12 months) × cognitive complexity | The "fix these first" list. Churn describes how the team works, not the code's state, and would make two runs of the same tree differ. |
| Secrets in git history | Secrets in past commits | The fix is rotating the key, which the code cannot show. |
| Development dependency vulnerabilities | Advisories in packages reachable only from development dependencies | They do not ship to production. |
| Excluded lines | Percentage of lines excluded by `.healthignore` | Makes exclusions visible to the reader. |
| Per-package breakdown | Every dimension per workspace package and per language | Shows where the pooled score comes from. |

## 8. What a 100 looks like

Concrete descriptions of a repository that scores 100 on every parameter.

### TypeScript

- **Tests.** vitest with `coverage.all`, at least 80% line and 70% branch coverage. Every module has a test file next to it. Every test asserts something. The suite is green.
- **Types.** `tsconfig.json` with `"strict": true` and `"noUncheckedIndexedAccess": true`. `tsc --noEmit` reports 0 errors. No `any`, no `as` casts other than `as const`, no `!` non-null assertions, no `@ts-ignore`. Every exported function has typed parameters.
- **Lint.** 0 findings from the pinned correctness rules, including `no-floating-promises` and `no-misused-promises`.
- **Architecture.** A `.dependency-cruiser.cjs` file with direction rules, run by `depcruise` in CI. No import cycles. Each feature folder has an `index.ts`, and other features import only from it. If there is a `domain/` folder, it imports no framework, database or network packages.
- **Size.** No function above cognitive complexity 15. No file above 500 logic lines. Under 3% duplication. `knip` reports no unused exports, files or dependencies.
- **Dependencies.** A lockfile in sync with `package.json`. No known vulnerabilities in production dependencies. Every direct dependency on its current major version. No secrets in tracked files.
- **Operability.** `npm ci && npm run build` works on a clean checkout. One script runs everything:

  ```json
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run --coverage",
    "check": "npm run typecheck && npm run lint && npm run test"
  }
  ```

  `npm run check` takes under a minute. CI runs it on every pull request. `.nvmrc` pins Node. Every `process.env.X` the code reads is listed in `.env.example`. `AGENTS.md` lists the commands, and every command in it exists.

### Python

A Python project at 100 uses a small set of modern tools. Most of them are configured in `pyproject.toml`.

- **Project and lockfile.** `uv` manages the environment. `uv.lock` is committed. `.python-version` pins the interpreter, and `requires-python` is set.
- **Tests.** pytest with pytest-cov, run with `--cov=<package> --cov-branch` so files no test imports are counted. At least 80% line and 70% branch coverage. Every module has a `test_<module>.py`. Every test has an `assert` or uses `pytest.raises`.
- **Types.** pyright in strict mode (or mypy with `strict = true`), with 0 errors. Every public function annotates its parameters and its return type. No `Any`, no `cast()`, no `# type: ignore`. Python does not enforce annotations at runtime; only the typechecker reads them.
- **Lint.** ruff reports 0 findings for rule sets F (Pyflakes: undefined names, unused imports), B (bugbear: likely bugs such as mutable default arguments) and E9 (syntax errors).
- **Architecture.** import-linter contracts declare the layers, and CI runs `lint-imports`. No import cycles (Python cycles also cause import-order errors at runtime). Code that is only needed for type annotations is imported under `if TYPE_CHECKING:`. A `domain/` package imports no framework, ORM or HTTP client.
- **Size.** No function above cognitive complexity 15 (complexipy). No module above 500 logic lines. Under 3% duplication. vulture finds no unused code, and deptry finds no unused, missing or transitive-only dependencies.
- **Operability.** `uv sync --frozen` works on a clean checkout, and the package imports. One command runs all checks, CI runs it on pull requests, and `AGENTS.md` lists it.

Example `pyproject.toml`:

```toml
[project]
name = "billing"
requires-python = ">=3.12"
dependencies = ["fastapi>=0.115", "sqlalchemy>=2.0"]

[dependency-groups]
dev = ["pytest>=8", "pytest-cov>=5", "pyright>=1.1.380", "ruff>=0.6", "import-linter>=2"]

[tool.pyright]
typeCheckingMode = "strict"

[tool.ruff.lint]
select = ["E", "F", "B", "I", "UP"]

[tool.pytest.ini_options]
addopts = "--cov=billing --cov-branch"

[tool.importlinter]
root_package = "billing"

[[tool.importlinter.contracts]]
name = "Layers"
type = "layers"
layers = ["billing.api", "billing.services", "billing.domain"]
```

Example `Makefile` target:

```make
check:
	uv run pyright
	uv run ruff check
	uv run pytest
```

## 9. Known limits of v1.0

1. **Anchors are not calibrated against a corpus.** They come from the cited sources and from judgement. The next step is to run v1.0 on a set of repositories and check that the bands match how those repositories feel to work in. Any anchor change will be a new version.
2. **Test quality is measured only by assertions.** A test can assert something trivial. Mutation testing would measure this directly but is too slow for every run, so it is out of v1.0.
3. **Tests that need external services fail.** No database, queue or browser is provided. Integration tests that need one count as failed in 1.1, and the code they cover counts as uncovered.
4. **Declared import rules replace the preset.** A repository can declare a permissive rules file and avoid the preset's rules. 3.1 still rewards the declaration with 50 or 100.
5. **Domain-driven design is checked only at the boundary.** 3.5 checks that domain code does not import infrastructure. It does not judge whether the domain model is good.
6. **Static analysis misses dynamic behaviour.** Dependency injection, plugin registration and string-based imports can make used code look unused (4.4) or hide imports (D3).
7. **Security covers known advisories and committed secrets only.** There is no static application security testing (SAST).
8. **6.3 varies between runs.** It is the only parameter that does, and it has a weight of 10%.
9. **Other languages are ignored.** Files in other languages do not count toward any parameter.

## 10. Versioning

- The methodology version is in `methodology.yaml` and in every `run.json`.
- Any change that can change a score creates a new version: a weight, an anchor, a band, a threshold, a rule, a preset, or the scope. Wording changes that cannot change a score do not.
- Runs from different methodology versions are never compared.
- Tool upgrades produce a new image digest. Runs with different digests are not compared either.

## 11. Sources

- AGENTS.md. https://agents.md
- Arguelles, Ivanković, Bender. Code Coverage Best Practices. Google Testing Blog, 2020. https://testing.googleblog.com/2020/08/code-coverage-best-practices.html
- Beck, K. Extreme Programming Explained, 2nd ed. Addison-Wesley, 2004 (Ten-Minute Build).
- Campbell, G. A. Cognitive Complexity: A new way of measuring understandability. SonarSource, 2018. https://www.sonarsource.com/docs/CognitiveComplexity.pdf
- Cockburn, A. Hexagonal Architecture (Ports and Adapters), 2005. https://alistair.cockburn.us/hexagonal-architecture/
- CWE-798: Use of Hard-coded Credentials. https://cwe.mitre.org/data/definitions/798.html
- dependency-cruiser rules reference. https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md
- deptry rules. https://deptry.com/rules-violations/
- ESLint max-lines rule, default 300. https://eslint.org/docs/latest/rules/max-lines
- Evans, E. Domain-Driven Design. Addison-Wesley, 2003.
- FastAPI: Bigger Applications - Multiple Files. https://fastapi.tiangolo.com/tutorial/bigger-applications/
- FIRST. CVSS v3.1 Specification, qualitative severity rating scale. https://www.first.org/cvss/v3.1/specification-document
- Fowler, M. Continuous Integration. https://martinfowler.com/articles/continuousIntegration.html
- gitleaks. https://github.com/gitleaks/gitleaks
- HackSoft Django Styleguide. https://github.com/HackSoftware/Django-Styleguide
- import-linter contract types. https://import-linter.readthedocs.io/en/stable/contract_types.html
- jscpd. https://github.com/kucherenko/jscpd
- knip. https://knip.dev
- Martin, R. C. Agile Software Development: Principles, Patterns, and Practices. Prentice Hall, 2002 (the Acyclic Dependencies Principle).
- Martin, R. C. Clean Architecture. Prentice Hall, 2017 (the Dependency Rule).
- McCabe, T. J. A Complexity Measure. IEEE Transactions on Software Engineering, 1976 (cyclomatic complexity, threshold 10).
- mypy command line: --strict. https://mypy.readthedocs.io/en/stable/command_line.html
- Next.js: Server and Client Components, keeping server-only code out of the client environment. https://nextjs.org/docs/app/getting-started/server-and-client-components
- npm ci documentation. https://docs.npmjs.com/cli/commands/npm-ci
- OSV schema (published, withdrawn, aliases). https://ossf.github.io/osv-schema/
- PEP 484: Type Hints. https://peps.python.org/pep-0484/
- Pylint too-many-lines (C0302), max-module-lines default 1000.
- Pyright configuration: typeCheckingMode. https://microsoft.github.io/pyright/#/configuration
- Ruff rules. https://docs.astral.sh/ruff/rules/
- Semantic Versioning 2.0.0, item 4 (major version zero). https://semver.org
- SonarQube default quality gate (Sonar way): coverage on new code at least 80%.
- SonarQube default quality gate (Sonar way): duplicated lines on new code at most 3%.
- SonarQube rule S3776 (Cognitive Complexity of functions should not be too high), default threshold 15.
- The Twelve-Factor App, III. Config. https://12factor.net/config
- TypeScript TSConfig reference: noUncheckedIndexedAccess. https://www.typescriptlang.org/tsconfig#noUncheckedIndexedAccess
- TypeScript TSConfig reference: strict. https://www.typescriptlang.org/tsconfig#strict
- typescript-eslint rules. https://typescript-eslint.io/rules/
- TypeScript: Type checking JavaScript files (checkJs). https://www.typescriptlang.org/docs/handbook/type-checking-javascript-files.html
- vulture. https://github.com/jendrikseipp/vulture
