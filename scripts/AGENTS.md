# Script Scope

Inherits the repository-root instructions. This file applies under `scripts/`.

- Add scripts only for maintained workflows, generators, proof runners, or compact CI wrappers used beyond one patch.
- Default output is a terse success line; failures include the bounded command, cause, and artifact/report location.
- Resolve paths from the repository root or script location; never depend on an agent-specific worktree name.
- Private-RAW helpers accept one external root and keep reports/artifacts ignored; never copy private media into tracked paths.
- Validate arguments before mutation, use unique temporary locations, and clean them in `finally`/trap paths.
- Keep benchmark/proof assertions inside the runner so CI and local execution enforce the same contract.
