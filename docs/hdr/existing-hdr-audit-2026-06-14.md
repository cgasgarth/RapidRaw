# Existing HDR Audit

- Date: 2026-06-14
- Issue: #163
- Status: audit-only; no runtime changes

## Current Runtime

- UI entry point: `src/components/modals/HdrModal.tsx`
- UI action path: `src/hooks/useProductivityActions.ts`
- Event listeners: `src/hooks/useTauriListeners.ts`
- Tauri commands: `merge_hdr` and `save_hdr` in `src-tauri/src/lib.rs`
- In-memory state: `AppState.hdr_result`

The current HDR runtime is apply-capable but legacy. It loads every selected path, requires at least two images, requires matching dimensions, reads ISO and exposure time metadata, creates `HDRInput` values, calls `hdr_merge_images`, converts the result to sRGB, stores the merged `DynamicImage` in memory, emits a PNG preview, and saves a rendered image through `save_hdr`.

## Current Schema Surface

- Command type: `computationalMerge.createHdr`
- Source role: `hdr_bracket`
- Sample: `packages/rawengine-schema/samples/hdr/computational-merge-hdr-command-envelope-v1.json`
- Existing parameters: `alignmentMode`, `bracketValidation`, `deghosting`, `maxPreviewDimensionPx`, `mergeStrategy`, `outputName`, `qualityPreference`, `sources`, `toneMapPreview`
- Existing source validation: all sources must use `hdr_bracket`; `bracketValidation: required` requires `exposureEv` on every source and at least two unique exposures.

This is schema-only. It does not yet bind the legacy Tauri HDR runtime to the versioned command bus, dry-run/apply plan acceptance, artifact provenance, or app-server tool contracts.

## Existing Validation

- Fixture work exists on a queued branch for #169 with `fixtures/hdr/hdr-synthetic-bracket-fixtures.json`.
- The fixture checker uses Zod, generates tiny deterministic PPM brackets in temp space, and covers static brackets, handheld translation plus motion/deghost metadata, and clipped-highlight recovery stress cases.
- `check:performance-smoke` includes the HDR fixture check on that queued branch.

## Gaps

- No HDR artifact schema with durable output handles, source hashes, graph revisions, stale/current state, or invalidation reasons.
- No dry-run result schema with bracket quality, exposure spacing, alignment estimate, deghost risk, highlight recovery metrics, memory estimate, warnings, and block codes.
- No apply result schema proving accepted dry-run plan ID/hash, output artifact, provenance, and editable derived-source registration.
- No command-bus runtime binding for `computationalMerge.createHdr`.
- No app-server HDR dry-run/apply tool manifest or replay validation.
- Legacy runtime mutates state immediately through Tauri invokes, not through a dry-run-first approval path.
- Legacy runtime stores only one HDR result in process memory, which is fragile for multiple jobs, app restarts, and provenance.
- Legacy runtime assumes same dimensions and metadata availability; it has no explicit bracket grouping, ordering, exposure-gap warning, alignment confidence, motion mask, deghost mask, or highlight recovery report.
- Preview tone mapping is baked into the current display path; editable scene-linear output boundaries are not explicit.

## RAW Corpus Placeholders

Issue #1897 reserves HDR RAW corpus slots:

- `real.hdr.interior-window-bracket.v0`
- `real.hdr.handheld-ghosting-bracket.v0`
- `raw-evidence.hdr.interior-window-bracket.v1`

These entries are schema/metadata only. They do not add bracket payloads,
rendered HDR output, deghost masks, source hashes, or quality claims. A later PR
must attach approved rights, hashes, bracket metadata, output artifacts, and
review evidence before these entries can count as runtime HDR proof.

## Recommended Issue Order

1. #162: capture consult guidance in a summary doc before changing contracts.
2. #163: keep this audit as a small docs-only PR.
3. #164: add HDR artifact, dry-run/apply, warning/block, provenance, and invalidation schemas.
4. #169: merge synthetic HDR fixture validation after schema naming stabilizes.
5. #165 and #166: add bracket detection and alignment smoke validation against generated fixtures.
6. #167 and #168: add merge weighting and deghost strategy validation.
7. #170: register merged HDR as an editable derived source.
8. #171 and #172: wire UI/API/app-server through dry-run/apply contracts.
9. #173: add performance and memory gates after the runtime contract is executable.

## Early PR Boundaries

Do not claim Capture One/Lightroom-level HDR output quality from schema, docs, or fixture-only work. Until runtime apply is command-bus backed and validated with image output evidence, label PRs as audit-only, schema-only, dry-run-only, fixture-only, or runtime apply-capable.
