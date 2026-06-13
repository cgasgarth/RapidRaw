# RawEngine Schema Package

- Date: 2026-06-13
- Issue: #211 `agent(schema): add dynamic tool schema package`
- Scope: first Zod-authored command, query, artifact, approval, and tool
  registry primitives for future app-server work.

## Purpose

`packages/rawengine-schema/` is the first dedicated schema surface for
RawEngine command/query and app-server tool contracts. It is intentionally small:
it defines the vocabulary and validation shape that future PRs can expand
without exposing runtime app-server tools yet.

## Included Schemas

- `CommandEnvelopeV1`
- `QueryEnvelopeV1`
- `ArtifactHandleV1`
- `ApprovalRequirementV1`
- `RawEngineToolDefinitionV1`
- `RawEngineToolRegistryV1`
- `NegativeLabAppServerToolManifestV1`
- `NegativeLabDensityNormalizationProfileV1`
- `NegativeLabFrameDetectionResultV1`
- `NegativeLabProcessProfileV1`
- `NegativeLabBuiltInPresetCatalogV1`
- `NegativeLabPresetMetadataPolicyCatalogV1`
- `NegativeLabQcProofArtifactV1`
- `NegativeLabRollBatchWorkflowV1`
- `NegativeLabFixtureManifestV1`
- `NegativeLabInputProfileCatalogV1`

The package also includes representative sample payloads, checked JSON sample
artifacts, and a `schema:check` script that typechecks the package and validates
samples with Zod.

## Rules

- Tool definitions are strict objects.
- Command and query envelopes are versioned.
- Mutating and dry-run behavior is represented in tool metadata.
- Approval class is schema data, not chat-only text.
- Artifact handles are the boundary for preview and raster outputs; full image
  payloads should not be embedded in tool JSON.
- This package does not expose Tauri commands or app-server runtime behavior.
- App-server tool manifests define typed runtime boundaries, but handler
  registration and transport wiring remain separate PRs.

## Validation

Run:

```sh
bun run schema:check
```

Feature PRs that add command families should add valid and rejected sample
payloads before wiring UI, Rust bridge, or app-server adapters.

Intentional sample changes should refresh checked artifacts with:

```sh
bun run schema:samples:update
```

Generated sample artifacts live under `packages/rawengine-schema/samples/` so
app-server adapter PRs can reference stable payloads without importing
TypeScript source directly.

Negative Lab density/process profile samples include:

- `negative-lab-density-normalization-profile-v1.json`
- `negative-lab-frame-detection-result-v1.json`
- `negative-lab-process-profile-v1.json`
- `negative-lab-built-in-preset-catalog-v1.json`
- `negative-lab-preset-metadata-policy-catalog-v1.json`
- `negative-lab-qc-proof-artifact-v1.json`
- `negative-lab-roll-batch-workflow-v1.json`
- `negative-lab-fixture-manifest-v1.json`
- `negative-lab-input-profile-catalog-v1.json`
