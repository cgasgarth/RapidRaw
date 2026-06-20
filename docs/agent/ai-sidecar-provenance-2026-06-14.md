# AI Sidecar Provenance

AI apply results must leave enough local sidecar metadata to audit and replay the
operation without storing raw prompt text.

## Required Fields

- provider class and provider id;
- model id, optional model version, and optional model hash;
- capability and quality preference when applicable;
- prompt policy and prompt hash for operator prompts;
- source content hash and source graph revision;
- accepted dry-run plan id and hash;
- approval class and approval record id;
- settings hash and output artifact ids.

## Validation

`tests/integration/checks/check-sidecar-roundtrip.ts` validates fixture `.rrdata` files with Zod
and now requires AI provenance entries in the primary sidecar fixture. The
fixture proves that mask and denoise apply operations preserve provider, model,
settings, dry-run, approval, source, and output artifact references through a
JSON sidecar roundtrip.

The Rust `ImageMetadata` type preserves `rawEngineArtifacts.aiProvenanceEntries`
as opaque values so older runtime paths can load and save sidecars without
dropping app-server AI provenance.

This is sidecar schema and preservation proof. It does not claim AI apply runtime
execution is fully wired through the app-server command bus yet.
