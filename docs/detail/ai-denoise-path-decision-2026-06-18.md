# AI Denoise Path Decision

Issue: #134

Runtime status: decision-only. This document does not ship new denoise quality,
preview/export parity, model weights, or end-to-end RAW workflow proof.

## Decision

Keep the first shippable AI denoise path local-model-first and provenance-first:
RawEngine should retain the existing Rust ONNX/NIND inference path for actual
model execution, then expose it through typed RawEngine command/app-server
contracts instead of trying to replace model inference with the Codex app server.

The Codex app server is an orchestration and tool-call surface. It can inspect,
dry-run, request approval, apply accepted plans, record provenance, and route
edits through the same typed command layer as the UI. It is not a drop-in
replacement for pixel inference, tiling, model loading, GPU/CPU fallback, or
deterministic render output.

## First Shippable Runtime Slice

- Stage: `scene_linear_denoise`, after demosaic and before deblur/detail
  sharpening.
- Provider: local model/runtime only for the first runtime slice.
- Existing model path: keep the ONNX/NIND implementation available while
  wrapping it in RawEngine contracts.
- Adapter proof: use the existing deterministic synthetic local adapter as
  contract proof, not as quality proof.
- Command shape: dry-run first, then apply by accepted dry-run plan id and hash.
- Output shape: derived denoise artifact with input hash, output hash, model id,
  model version/hash, provider class, tile size, overlap, backend, warnings, and
  stale-on-source-or-settings-change policy.
- UI behavior: keep any AI denoise control visibly separate from luma/chroma
  classical denoise and label quality/proof status until real-image proof lands.

## Accepted

- Keep ONNX runtime model execution because it performs local numerical image
  inference; app-server tools should call into the typed command layer around
  that runtime.
- Require deterministic dry-run and apply paths before claiming agent
  editability.
- Require no-original-overwrite behavior: AI denoise outputs are derived
  artifacts or graph nodes, not destructive source replacements.
- Track low-confidence or unsupported provider/backend states in warnings and
  approval requirements.
- Treat model provenance as required metadata, even before model quality is
  mature.

## Deferred

- Replacing or upgrading the NIND model.
- Broad real RAW quality claims.
- GPU/CPU parity claims.
- Preview/export parity claims.
- Cloud/provider denoise.
- Diffusion or hallucination-prone restoration as a trusted correction path.
- Fully automatic one-click quality decisions without approval and audit.

## Validation Requirements

The first runtime PR should pass:

- `bun run check:ai-denoise-runtime-apply`
- `bun run check:ai-denoise-app-server-tool`
- `bun run check:denoise-fixtures`
- `bun run check:denoise-cpu-reference`
- `bun run check:denoise-preview-runtime`
- `bun run check:denoise-workflow-smoke`

The preview/export parity proof remains pending until preview and export run
through independent production paths.

Maturity requires additional evidence:

- licensed synthetic fixture manifest coverage;
- private high-ISO real RAW crop ledger coverage;
- preserved before/after artifacts;
- preview/export parity proof;
- deterministic replay proof;
- cancellation and rollback behavior;
- UI or Computer Use proof for the complete workflow.

## Follow-Ups

- #1866 proves deterministic local AI denoise adapter apply behavior without
  claiming real RAW quality.
- #1267 tracks runtime and end-to-end proof after this decision slice.
