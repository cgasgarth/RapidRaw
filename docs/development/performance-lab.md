# RapidRaw performance lab

The executable lab records repeated metrics from versioned scenarios with correctness assertions, fixture identity, source/build identity, privacy-filtered hardware class, raw samples, robust summaries, and exact rerun commands.

```bash
bun perf list
bun perf run editor.preview-scheduling
bun perf run editor.preview-scheduling --baseline private-artifacts/perf/baseline.json
bun perf baseline-add private-artifacts/perf/history.json private-artifacts/perf/baseline.json --actor reviewer-name --reason "reviewed stable local run" --signing-key private-artifacts/perf/reviewer-ed25519.pem
bun perf baseline-export private-artifacts/perf/history.json private-artifacts/perf/canonical-history.json
bun perf baseline-import private-artifacts/perf/canonical-history.json private-artifacts/perf/imported-history.json --quarantine private-artifacts/perf/quarantine
bun perf run editor.preview-scheduling --history private-artifacts/perf/history.json
bun perf trend private-artifacts/perf/history.json private-artifacts/perf/candidate.json
bun perf compare private-artifacts/perf/baseline.json private-artifacts/perf/candidate.json
bun perf bisect-evaluate private-artifacts/perf/baseline.json private-artifacts/perf/candidate.json
bun perf bisect-plan --scenario editor.preview-scheduling --good <sha> --bad <sha> --history private-artifacts/perf/history.json
bun perf affected --base origin/main
bun perf ci-gate --history private-artifacts/perf/history.json --candidate private-artifacts/perf/candidate.json --output artifacts/performance-lab/trend-gate.json
bun perf artifact-manifest --receipt private-artifacts/perf/candidate.json --file private-artifacts/perf/candidate.json --output artifacts/performance-lab/upload-manifest.json
bun perf retention-plan --history private-artifacts/perf/history.json --index private-artifacts/perf/artifact-index.json
```

`editor.preview-scheduling` executes the adjustment-snapshot scheduling hot path directly. Setup is excluded, two warmups precede nine retained samples, and every retained run proves its deterministic dispatch sink before it can be valid. Receipts remain under ignored `private-artifacts/perf` unless `--output` selects another location.

Comparisons require the same scenario/version, fixture digest, cache mode, hardware class, and build profile. A latency gate regresses only when its p95 exceeds both relative and absolute thresholds. Raw samples, median, p95, and MAD remain available for trend inspection.

Baseline history is an append-only signed review ledger. Every passing approval binds the reviewer actor and reason, source run and commit, canonical receipt SHA-256, preceding entry hash, current entry hash, reviewer public key, and Ed25519 signature. Reads verify the complete chain before selection, gating, or retention. Duplicate run IDs, changed actor keys, reordered links, modified receipts/provenance, invalid signatures, and approvals predating their runs are rejected. Selection chooses the latest compatible approval that predates the candidate. Trend output retains every compatible historical comparison and names the deterministically selected baseline. Regression runs emit a typed sibling artifact naming the divergent metric, exact rerun, commits, and dry-run bisect-plan command.

History export uses sorted-key canonical JSON, so repeated verified import/export is byte-identical. `baseline-import` never overwrites a corrupt payload: invalid JSON, schema, hash chain, provenance, or signature is copied with mode `0600` to a digest-addressed private quarantine and exits invalid; the source remains untouched.

For `git bisect run`, the generated plan uses the normal runner, which returns `0` for pass, `1` for regression, and `125` for an invalid measurement. `bisect-plan` only prints validated commands; it never changes the current checkout. Baselines never update themselves; an approved receipt remains immutable input with exact commit provenance.

The `affected` command emits the versioned `performance-scenarios` JSON contract consumed by affected-validation selection. Known preview scheduling sources select the focused scenario; performance infrastructure or unknown paths conservatively select the full registered lab.

`ci-gate` emits a validated pass, regression, or invalid contract and fails closed with exit codes `0`, `1`, and `2`. Latency and throughput compare only within an exact privacy-filtered hardware class; deterministic work-count metrics may compare across operating systems and architectures. The manual performance workflow runs the real scenario, optionally enforces a checked-out approved history, and always uploads the receipt plus a content-digested upload manifest.

Upload manifests bind absolute artifact paths, byte sizes, SHA-256 digests, run status, hardware class, and retention windows. `retention-plan` is intentionally non-destructive: it lists prune candidates after 14 days for ordinary unapproved runs and 30 days for regressions, but every run referenced by approved history remains in `keep` regardless of age. It never deletes history or artifacts itself.
