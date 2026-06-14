# AI Denoise Research

- Date: 2026-06-14
- Issue: #134 `detail(ai-denoise): research AI denoise path`
- Milestone: 8: Detail Denoise And Wavelet Tools
- Scope: migration and validation contract for existing AI denoise.

## Decision

RawEngine should keep inherited local denoise useful, but AI denoise must not be
treated as a production app-server or agent tool until it has provenance,
artifact invalidation, fixture gates, and explicit provider boundaries.

The current RapidRAW path is runtime-capable through Tauri commands:

- `apply_denoising`
- `batch_denoise_images`
- `save_denoised_image`
- local BM3D-style denoise
- `method: "ai"` using the NIND ONNX model

This research issue does not migrate that path. It defines the constraints for
the later migration.

## Accepted Direction

AI denoise should become a typed derived-artifact workflow:

- dry-run first;
- apply only after a stable plan ID/hash;
- output as a new derived artifact, never overwrite the original;
- source image, settings, model, runtime, and warnings recorded in provenance;
- app-server tools use the same typed command layer as the UI;
- local model execution remains the default first implementation;
- cloud or external provider denoise requires explicit upload approval and
  privacy evidence.

The first agent-facing surface should be conservative:

- inspect denoise capability;
- estimate cost/time/memory;
- dry-run settings and warnings;
- apply to selected files only;
- save derived output with sidecar provenance;
- cancel running work;
- report artifact path and validation summary.

## Current Gaps

- Denoise event payloads are typed in TypeScript, but the command input/output
  contract is not versioned as a RawEngine command schema.
- `denoise_result` is transient process state until `save_denoised_image` writes
  a file.
- Output files copy sidecar data but do not yet record a full denoise artifact
  node with model/runtime/settings provenance.
- Batch denoise writes outputs directly without a dry-run plan or per-file
  approval ledger.
- The AI model download path is local, but app-server tools need explicit model
  provenance and availability reporting.
- The current UI path does not expose fixture-backed luma/chroma detail
  preservation metrics.
- App-server migration must not expose raw Tauri invokes.

## Tool Contract Sketch

Future app-server tools should be generated from Zod-backed schemas:

- `denoise.inspect_capabilities`
- `denoise.dry_run`
- `denoise.apply`
- `denoise.cancel`
- `denoise.read_artifact`

Required dry-run inputs:

- source image IDs or selected paths;
- method: `bm3d`, `local_ai`, or future provider ID;
- intensity;
- output format policy;
- max long edge or full-resolution flag;
- user-approved upload scope for any non-local provider;
- expected session revision.

Required apply inputs:

- accepted dry-run plan ID;
- accepted plan hash;
- source image IDs;
- output directory policy;
- no-overwrite flag;
- acknowledged warning codes.

Required outputs:

- generated artifact IDs;
- output paths;
- source hashes or stable source IDs;
- model ID/version/hash when applicable;
- runtime and device info;
- warnings;
- validation metric summary when fixtures or sample crops are available;
- cancellation/failure state.

## Validation Gates

Before AI denoise is considered production-ready, add:

- synthetic high-ISO flat shadow, chroma edge, and fine texture fixtures;
- real-photo private review fixtures for skin, hair, fabric, foliage, and shadow
  color noise;
- luma noise reduction metric;
- chroma noise reduction metric;
- detail-loss metric;
- hue/chroma shift metric;
- before/after crop sheets at 100 percent and 200 percent;
- preview/save parity proof;
- batch dry-run/apply replay tests;
- no-original-overwrite tests;
- model provenance sidecar tests;
- cancellation tests;
- app-server tool schema drift and approval-boundary tests.

Fail closed when denoise smears real detail, invents texture, shifts color,
destroys grain intentionally preserved by film simulations, or tries to upload
pixels without explicit approval.

## Implementation Order

1. Add command schemas for denoise dry-run/apply/cancel/read-artifact.
2. Add derived artifact provenance schema for denoise outputs.
3. Add fixture metrics for luma/chroma separation and detail preservation.
4. Wrap existing Tauri denoise commands behind the typed command layer.
5. Add no-overwrite and cancellation tests.
6. Add app-server tool manifest samples generated from the schemas.
7. Add UI evidence ledger and crop-sheet review artifacts.

## Consult Status

This is a preliminary research contract, not consult-backed runtime approval.
Before migration, runtime denoise math, or app-server tool design starts, open a
new RapidRaw ChatGPT project consult with the GitHub repo attached. Ask it to
review local model strategy, denoise metrics, color/detail preservation gates,
artifact provenance, batch safety, and the iterative quality ladder. Record
accepted advice, rejected advice, validation thresholds, and the next measurable
improvement target in an ADR or summary doc.

## Validation Commands

- `bunx prettier --check docs/detail/ai-denoise-research-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md`
- `bun scripts/check-markdown-links.mjs`
- `git diff --check`
