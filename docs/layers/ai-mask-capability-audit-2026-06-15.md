# AI Mask Capability Audit

- Issue: #120
- Scope: subject, sky, foreground, background, and depth AI mask capability
  coverage.
- Runtime status: audit evidence only. This verifies current command, schema,
  fixture, and render-branch coverage. It does not benchmark segmentation
  quality or migrate these tools to the app-server agent surface.

## Capability Matrix

| Capability | Status  | Frontend invoke command       | Render mask type | Notes                                      |
| ---------- | ------- | ----------------------------- | ---------------- | ------------------------------------------ |
| Subject    | Native  | `generate_ai_subject_mask`    | `ai-subject`     | SAM encoder/decoder path, point/box input. |
| Sky        | Native  | `generate_ai_sky_mask`        | `ai-sky`         | Sky U-2-Net path.                          |
| Foreground | Native  | `generate_ai_foreground_mask` | `ai-foreground`  | U-2-Net foreground path.                   |
| Background | Derived | None                          | `ai-foreground`  | Derived by inverting foreground coverage.  |
| Depth      | Native  | `generate_ai_depth_mask`      | `ai-depth`       | Depth Anything V2 range mask path.         |

## Validation Contract

`fixtures/masks/ai/ai-mask-capabilities.json` is the committed source fixture.
`src/utils/ai/aiMaskCapabilities.ts` exposes the runtime audit table after parsing
through `src/schemas/masks/aiMaskingSchemas.ts`.

`tests/integration/checks/ai/check-ai-mask-capabilities.ts` verifies:

- fixture and runtime audit table parity;
- Zod schema coverage for all required capability names;
- TypeScript mask enum coverage in `src/components/panel/right/Masks.tsx`;
- frontend invoke command coverage in `src/components/ui/AppProperties.tsx`;
- Rust Tauri command coverage in `src-tauri/src/ai_commands.rs`;
- Rust render branch coverage in `src-tauri/src/render/mask_generation.rs`.

## Known Gaps

- Runtime quality benchmarking remains future work.
- Sky and depth are present in backend and mask panel types but not in all AI
  panel creation lists.
- Background is derived from foreground, not a separate native model.
- App-server AI mask tool migration remains tracked separately.
