# Headless Render Command

Issue: #81

`bun scripts/dev/rawengine-headless-render.ts --request <request.json> --output <artifact.json>` replays one approved basic tone command into a deterministic synthetic render artifact.

Inputs:

- `HeadlessRenderRequest` in `src/schemas/export/headlessRenderCommandSchemas.ts`.
- Current public fixture: `fixtures/validation/render-requests/headless-render-command-request.json`.

Outputs:

- `HeadlessRenderArtifact` JSON containing before/after hashes, changed pixel count, graph revision, renderer id, and output pixels.

Validation:

- `bun run check:headless-render-command`

Status: runtime artifact-write proof for a synthetic basic tone render only. Full UI-to-headless parity and real RAW corpus proof stay in separate issues.
