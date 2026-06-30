# Panorama Architecture Consult Review

- Date: 2026-06-13
- Issue: #174 `consult(panorama): get panorama architecture review`
- Milestone: 11: Panorama Stitching
- Scope: architecture review and implementation sequence for professional
  editable panorama support.

## Status

External ChatGPT Pro Extended consultation was completed in the RapidRaw
project with the GitHub repository attached. The consult inspected the
panorama docs, current Rust/Tauri stitcher path, schema samples, issue list,
and package validation scripts. This document records the accepted findings
after checking them against the current repository direction.

## Current Repo-Grounded Position

RapidRaw already has a local panorama stitcher with real feature detection,
descriptor matching, homography estimation, graph ordering, full-resolution
warping, adaptive seam placement, feathered blending, preview generation, and
save behavior. RawEngine should preserve that value while changing the product
contract from "modal creates one in-memory rendered image" to "panorama creates
a versioned editable derived artifact that can re-enter the normal edit graph."

Existing planning docs cover the first contract slices:

- `docs/panorama/architecture/rapidraw-stitcher-audit-2026-06-13.md`
- `docs/panorama/artifacts/panorama-artifact-schema-2026-06-13.md`
- `docs/panorama/projection/projection-options-2026-06-13.md`
- `docs/panorama/projection/boundary-controls-2026-06-13.md`
- `docs/panorama/projection/exposure-normalization-2026-06-13.md`
- `docs/panorama/projection/multi-row-support-audit-2026-06-13.md`
- `docs/panorama/architecture/large-panorama-tiling-strategy-2026-06-13.md`

The Zod schema package already includes panorama artifact contracts and
computational merge command/result samples. That makes the next panorama work a
runtime integration problem more than a blank-schema problem.

## Architecture Direction

The professional path should use a staged adapter architecture:

1. Keep the current RapidRaw stitcher as the first `PanoramaEngine` adapter.
2. Add a plan/apply job boundary before changing core CV behavior.
3. Persist panorama plans and results as computational merge artifacts.
4. Let UI, API, and app-server tools talk to typed plan/apply contracts rather
   than direct one-shot Tauri commands.
5. Add advanced projection, exposure, multi-row, and tiling behavior behind the
   adapter boundary as separately validated capability upgrades.

The first production-facing contract should not claim that deferred projection
or fill modes are rendered by the current engine. Schema fields can expose
requested/effective modes, support level, and deferred reason so UI and agents
can be honest about runtime capability.

## Key Risks

- **Overclaiming geometry support:** Current graph traversal can connect
  multi-row-ish captures, but it does not model rows, columns, horizon, field of
  view, or projection selection enough to call multi-row professional.
- **Flattened output trap:** Saving a TIFF/PNG beside the first source image
  would make later layers, masks, exports, agent tools, and provenance harder.
- **Memory spikes:** Full-frame float canvases and masks can consume gigabytes
  before tile rendering exists.
- **Seam hiding instead of normalization:** Seam selection cannot compensate for
  avoidable exposure, white balance, vignette, or color mismatch.
- **Schema/runtime drift:** If schema-only controls are not backed by fixtures
  and deferred warnings, UI and API surfaces can diverge from runtime truth.
- **Unreviewable CV rewrites:** Replacing the stitcher wholesale before adding
  artifact/job/fixture contracts would make regressions harder to isolate.

## Accepted Consult Findings

The consult agreed with the core RawEngine direction: panorama output should be
a first-class editable derived artifact with source provenance and invalidation,
not a flattened save file. It also identified the highest near-term risk as
contract drift between schema/docs and runtime support.

Accepted decisions:

- Keep the current RapidRaw stitcher, but wrap it as a legacy homography engine
  adapter instead of letting UI, API, or app-server tools depend on
  `stitch_panorama`/`save_panorama` directly.
- Harden schema invariants before adding more runtime/UI surface so
  requested/effective support, engine capabilities, source counts,
  output-artifact requirements, and duplicate summary fields cannot drift.
- Add a dry-run/preflight command before professional UI/API claims. It must
  return source dimensions, output estimates, memory budget decisions,
  capabilities, and durable warnings without writing sidecars or images.
- Persist rendered panoramas as editable derived artifacts with source asset
  hashes, source edit graph revisions, engine versions, settings, output
  handles, preview handles, warnings, and provenance.
- Build deterministic fixture and review-artifact coverage before exposing
  serious visual controls or claiming runtime projection/exposure/multi-row
  quality.
- Evaluate OpenCV as a later engine adapter, not as an immediate dependency and
  not as a schema dependency. Hugin/Panorama Tools can be useful as a reference
  oracle or optional expert backend later, but should not be a required app
  dependency until packaging, licensing, sandboxing, deterministic output, and
  progress/error parsing are solved.

Rejected or deferred suggestions:

- Do not replace the current stitcher wholesale before adapter, artifact, and
  fixture contracts exist.
- Do not treat a saved TIFF/PNG as the durable panorama artifact.
- Do not expose raw Tauri invokes directly to app-server tools.
- Do not claim cylindrical/spherical or professional multi-row runtime support
  until camera/lens/projection preconditions and metrics are validated.

## Recommended Implementation Sequence

The consult refined the issue order into smaller bridge work between the
completed planning docs and the later UI/API/performance tasks:

1. **Close #174 with this architecture review.** Keep it docs-only and record
   accepted follow-up issues.
2. **#979 `panorama(schema): harden artifact support invariants`.** Add Zod
   refinements for support consistency, output-artifact requirements, source
   counts, and capability drift before more runtime depends on the schema.
3. **#983 `panorama(engine): wrap current stitcher behind adapter boundary`.**
   Move the current Rust behavior behind a legacy engine adapter without
   changing output behavior.
4. **#980 `panorama(plan): add dry-run memory and geometry preflight`.** Add a
   plan-only command that returns source metadata, geometry estimates, memory
   estimates, capabilities, warnings, and blocked/accepted status.
5. **#982 `panorama(artifact): persist editable derived panorama sources`.**
   Store the panorama as a durable computational artifact and editable virtual
   source with source graph invalidation.
6. **#182 `validation(panorama): add panorama fixture set`.** Add deterministic
   synthetic fixtures and metadata-only large fixtures before UI polish.
7. **Runtime feature slices.** Implement projection, boundary, and exposure as
   separate capability-backed runtime PRs after plan/artifact/fixture coverage
   exists.
8. **#183 `ui(panorama): add panorama UI`.** UI should consume the same typed
   plan/apply results as API and app-server tools.
9. **#184 `api(panorama): add panorama API tools`.** Expose typed plan, render,
   cancel, read, and refresh operations through the API/app-server layer.
10. **#984 `panorama(adapter): evaluate OpenCV stitching backend`.** Research a
    future OpenCV adapter behind the engine boundary. Do not add a runtime
    dependency in the research PR.
11. **#185 `validation(panorama): add panorama performance tests`.** Add large
    panorama memory/performance tests with configured budgets and nightly/manual
    placement where appropriate.

## Validation Strategy

Minimum validation before runtime feature claims:

- schema sample validation for panorama artifact and computational merge
  plan/apply contracts;
- deterministic synthetic fixture tests for simple translations and failure
  modes;
- output-bounds and source-count metrics;
- reprojection RMS/p95 and inlier-count checks once runtime exposes them;
- before/after exposure normalization metrics for overlap regions;
- memory-budget dry-run tests independent of runner memory size;
- generated review artifacts for fixture previews;
- nightly or release performance tests for large panorama cases.

Recommended panorama validation entry points once runtime fixture work begins:

- `validation:panorama:schema`: schema samples and negative samples.
- `validation:panorama:fixtures`: deterministic fixture validation.
- `validation:panorama:render-smoke`: tiny Rust render smoke tests.
- `validation:panorama:visual`: HTML review artifacts with overlays and
  warnings.
- `validation:panorama:perf`: larger ignored/nightly performance and memory
  tests.

Review artifacts should include source thumbnails, selected/excluded component
diagrams, control-point overlays, pairwise overlap heatmaps, seam overlays,
valid-pixel masks, crop/boundary overlays, exposure before/after strips, final
previews, warning tables, memory estimates, and command/provenance JSON.

## Early Non-Goals

- Do not implement every projection mode before the plan/apply and artifact
  contracts are stable.
- Do not promise multi-row support based only on pairwise graph connectivity.
- Do not add UI controls that imply runtime support when the engine still
  defers that behavior.
- Do not make large panorama rendering a required gate until preflight and
  recoverable failure behavior are fixture-backed.
- Do not replace the current stitcher with a new CV stack in the same PR that
  introduces artifact persistence or API contracts.

## Consult Findings To Incorporate

Complete. Accepted findings are summarized above and converted into concrete
GitHub follow-up issues.

## Follow-Up Issue Check

New issues opened from the consult:

- #979 `panorama(schema): harden artifact support invariants`
- #980 `panorama(plan): add dry-run memory and geometry preflight`
- #982 `panorama(artifact): persist editable derived panorama sources`
- #983 `panorama(engine): wrap current stitcher behind adapter boundary`
- #984 `panorama(adapter): evaluate OpenCV stitching backend`

Existing milestone issues remain active for fixture, UI, API, and performance
work:

- #182 `validation(panorama): add panorama fixture set`
- #183 `ui(panorama): add panorama UI`
- #184 `api(panorama): add panorama API tools`
- #185 `validation(panorama): add panorama performance tests`

## Validation

Required local checks for the PR that finalizes this document:

```sh
bun run docs:check
git diff --check
```
