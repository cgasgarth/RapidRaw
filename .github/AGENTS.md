# GitHub Automation Scope

Inherits the repository-root instructions. This file applies under `.github/`.

- Keep `PR CI / required` strict, parallel, non-canceling, and fail-closed for path-gated jobs.
- Pin third-party actions to supported full commit SHAs and retain the release tag in a comment.
- Reuse composite setup actions and maintained suite commands; avoid duplicated dependency/bootstrap YAML.
- New deterministic product regressions belong in local suites first, then in the cheapest relevant required gate.
- Bound job time, cache keys, logs, and uploaded diagnostics; successful runs should stay compact.
- Workflow changes need actionlint/pin validation and evidence that skip decisions cannot mask required work.
