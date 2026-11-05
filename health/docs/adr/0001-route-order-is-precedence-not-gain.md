# Route selection by Gain, Slice order by fixed precedence

The Route is chosen greedily: at each point, the Step that raises health most, until the displayed health reaches the Target band. The Slices are not written in that order. They are ordered by a fixed precedence kept in the Pack's code: (1) secrets and known vulnerabilities (5.4, 5.1); (2) the repo installs, builds and verifies (6.1, 5.3, 5.5, 6.2, 6.5); (3) safety net (1.1, 1.4, 1.2, 1.3, 1.5); (4) types and lint (2.1, 2.2, 2.5, 2.3, 2.4); (5) CI and docs (6.4, 6.6, 6.3); (6) structural refactors and major upgrades (3.x, 4.x, 5.2). A parameter's anchors go in ascending order.

Gain order would put refactors (4.1 complex functions) ahead of a passing test suite, so an agent would change structure with nothing to catch a regression. The precedence makes each Slice verifiable by checks that earlier Slices set up. The precedence never changes a score, so it is Pack code, not methodology, and changing it needs no new methodology version.

## Considered options

- Order by Gain: shortest-looking progress, but unsafe for agents working without memory of the codebase.
- Put the precedence in the methodology YAML: rejected, because it is advice about working order, not scoring.
