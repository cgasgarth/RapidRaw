# RapidRaw performance lab

The executable lab records repeated metrics from versioned scenarios with correctness assertions, fixture identity, source/build identity, privacy-filtered hardware class, raw samples, robust summaries, and exact rerun commands.

Every valid receipt also carries monotonic per-sample spans under its run identity. The runner bounds every child span to the measured sample; preview scenarios identify frontend control and instrumented dispatch stages, while browser scenarios separate harness setup from the terminal QA interaction. Missing or impossible trace spans invalidate the run instead of producing a speed claim.

```bash
bun perf list
bun perf run editor.preview-scheduling
bun perf run browser.editor-open
bun perf run browser.editor-compare
bun perf run browser.editor-crop
bun perf run browser.library-open
bun perf run editor.preview-scheduling --baseline private-artifacts/perf/baseline.json
bun perf baseline-add private-artifacts/perf/history.json private-artifacts/perf/baseline.json --actor reviewer-name --reason "reviewed stable local run" --signing-key private-artifacts/perf/reviewer-ed25519.pem
bun perf baseline-export private-artifacts/perf/history.json private-artifacts/perf/canonical-history.json
bun perf baseline-import private-artifacts/perf/canonical-history.json private-artifacts/perf/imported-history.json --quarantine private-artifacts/perf/quarantine
bun perf run editor.preview-scheduling --history private-artifacts/perf/history.json
bun perf trend private-artifacts/perf/history.json private-artifacts/perf/candidate.json
bun perf compare private-artifacts/perf/baseline.json private-artifacts/perf/candidate.json
bun perf bisect-evaluate private-artifacts/perf/baseline.json private-artifacts/perf/candidate.json
bun perf bisect-plan --scenario editor.preview-scheduling --good <sha> --bad <sha> --history private-artifacts/perf/history.json
bun perf bisect --scenario editor.preview-scheduling --good <sha> --bad <sha> --history private-artifacts/perf/history.json --output private-artifacts/perf/bisect.json
bun perf affected --base origin/main
bun perf ci-gate --history private-artifacts/perf/history.json --candidate private-artifacts/perf/candidate.json --output artifacts/performance-lab/trend-gate.json
bun perf artifact-manifest --receipt private-artifacts/perf/candidate.json --file private-artifacts/perf/candidate.json --output artifacts/performance-lab/upload-manifest.json
bun perf retention-plan --history private-artifacts/perf/history.json --index private-artifacts/perf/artifact-index.json
```

`editor.preview-scheduling` executes the adjustment-snapshot scheduling hot path directly. Setup is excluded, two warmups precede nine retained samples, and every retained run proves both control and instrumented dispatch sinks before it can be valid. It records control cost, light snapshot-instrumentation overhead, CPU time, resident memory, filesystem operations, and deterministic dispatch work separately, and invalidates a run above the documented 5 ms overhead ceiling. Receipts remain under ignored `private-artifacts/perf` unless `--output` selects another location.

`browser.editor-open`, `browser.editor-compare`, `browser.editor-crop`, and `browser.library-open` execute the repository-owned Playwright/Tauri browser scenarios end to end. The editor-open lane covers the progressive image-loading path through a visible editor terminal state, while the crop lane measures a geometry interaction and its committed terminal state. One persistent QA daemon is reused for the warmup and five measured samples, then shut down if the performance runner started it. Each retained sample validates the terminal QA receipt, balanced browser-context accounting, and zero leaks before recording interaction, setup, runner overhead, process starts/starts avoided, source refresh/reuse, wait, recovery, and artifact metrics. The performance workflow runs every registered scenario in independent lanes; the former readiness-only scaffold no longer counts as runtime coverage.

Browser fixture digests bind the scenario ID plus the actual QA scenario and generated-fixture source bytes. Changing terminal actions or fixture construction therefore creates a new comparable identity and cannot reuse an older baseline silently.

Comparisons require the same scenario/version, fixture digest, cache mode, hardware class, and build profile. A latency gate regresses only when its p95 exceeds both relative and absolute thresholds. Raw samples, median, p90, p95, MAD, IQR, and a fixed-seed 2,000-resample bootstrap 95% median interval remain available for reproducible trend inspection.

Hardware identity hashes privacy-filtered CPU, GPU/Metal, display-resolution, and storage-class descriptors alongside core count and RAM. Environment identity records OS/architecture, Bun/Node/Rust versions, one-minute background load, power source, and an explicit thermal-state override when dedicated hardware supplies one. Unavailable platform fields are recorded as `unreported`; they are never silently confused with a measured descriptor.

Baseline history is an append-only signed review ledger. Every passing approval binds the reviewer actor and reason, source run and commit, canonical receipt SHA-256, preceding entry hash, current entry hash, reviewer public key, and Ed25519 signature. Reads verify the complete chain before selection, gating, or retention. Duplicate run IDs, changed actor keys, reordered links, modified receipts/provenance, invalid signatures, and approvals predating their runs are rejected. Selection chooses the latest compatible approval that predates the candidate. Trend output retains every compatible historical comparison and names the deterministically selected baseline. Regression runs emit a typed sibling artifact naming the divergent metric, the largest matching trace-stage divergence, count/byte work amplification when present, exact rerun, commits, and dry-run bisect-plan command.

History export uses sorted-key canonical JSON, so repeated verified import/export is byte-identical. `baseline-import` never overwrites a corrupt payload: invalid JSON, schema, hash chain, provenance, or signature is copied with mode `0600` to a digest-addressed private quarantine and exits invalid; the source remains untouched.

For `git bisect run`, the normal runner returns `0` for pass, `1` for regression, and `125` for an invalid measurement. `bisect-plan` only prints validated commands. `bisect` requires a clean worktree, executes the same evaluator across the requested ancestry, records either the exact first bad commit or the bounded candidate range left by skipped invalid commits, and always resets the checkout before returning. Baselines never update themselves; an approved receipt remains immutable input with exact commit provenance.

The `affected` command emits the versioned `performance-scenarios` JSON contract consumed by affected-validation selection. Known preview scheduling sources select the focused scenario; performance infrastructure or unknown paths conservatively select the full registered lab.

`ci-gate` emits a validated pass, regression, or invalid contract and fails closed with exit codes `0`, `1`, and `2`. Latency and throughput compare only within an exact privacy-filtered hardware class; deterministic work-count metrics may compare across operating systems and architectures. The manual performance workflow runs the real scenario, optionally enforces a checked-out approved history, and always uploads the receipt plus a content-digested upload manifest.

Upload manifests bind absolute artifact paths, byte sizes, SHA-256 digests, run status, hardware class, and retention windows. `retention-plan` is intentionally non-destructive: it lists prune candidates after 14 days for ordinary unapproved runs and 30 days for regressions, but every run referenced by approved history remains in `keep` regardless of age. It never deletes history or artifacts itself.
