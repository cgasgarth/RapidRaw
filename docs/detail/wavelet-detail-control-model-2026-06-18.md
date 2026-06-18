# Wavelet Detail Control Model

Issue: #128

## Goal

Define the first RawEngine detail-by-scale control model tightly enough that the existing Zod recipe, fixture gate, and visual detail workspace can be implemented without inventing UI semantics later. This is a design/control contract only; it does not claim final pixel-quality wavelet rendering.

## Control Surface

| Control          | Type              |                                Range | Default | Recipe field      | Notes                                                                                                                 |
| ---------------- | ----------------- | -----------------------------------: | ------: | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Detail by scale  | toggle            |                               on/off |     off | active scales     | Enables the panel and writes active scale state. Off must serialize every scale as `enabled: false` with `amount: 0`. |
| Preview mode     | segmented control | `off`, `luma_detail`, `before_after` |   `off` | `previewMode`     | `luma_detail` shows extracted detail energy; `before_after` is for UI comparison.                                     |
| Fine detail      | slider            |                          -100 to 100 |       0 | `fine.amount`     | Microtexture and eyelashes; should be conservative on high ISO.                                                       |
| Fine radius      | numeric stepper   |                        0.6 to 2.0 px |  1.0 px | `fine.radiusPx`   | Radius must remain below medium.                                                                                      |
| Medium detail    | slider            |                          -100 to 100 |       0 | `medium.amount`   | Fabric, bark, hair groups, and subject texture.                                                                       |
| Medium radius    | numeric stepper   |                        2.5 to 8.0 px |  4.0 px | `medium.radiusPx` | Radius must remain above fine and below coarse.                                                                       |
| Coarse structure | slider            |                          -100 to 100 |       0 | `coarse.amount`   | Large local structure; overlaps with clarity/local contrast, so it needs a lower default.                             |
| Coarse radius    | numeric stepper   |                          10 to 32 px |   16 px | `coarse.radiusPx` | Radius must remain above medium.                                                                                      |
| Edge threshold   | slider            |                               0 to 1 |    0.25 | `edgeThreshold`   | Higher values limit effects to stronger edges and reduce noise lift.                                                  |
| Halo suppression | slider            |                               0 to 1 |    0.75 | `haloSuppression` | Higher values protect transitions and should be enabled before strong coarse boosts.                                  |

## Pipeline Placement

- Apply after demosaic, white balance, lens correction, and luma/chroma denoise.
- Apply before creative grain, film simulation, output sharpening, display transform, and export encoding.
- Treat negative values as scale-local smoothing/detail suppression, not generic blur.
- Keep wavelet detail independent from `clarity`, `structure`, and local contrast controls; later UI can show conflicts when coarse structure and local contrast both run hot.

## Sidecar And Edit Graph

The canonical sidecar/edit-graph payload is `waveletDetailRecipeSchema` in `src/schemas/waveletDetailSchemas.ts`.

- Treat the recipe as durable edit intent. Preview pass order, renderer kernels, and artifact metadata are provisional renderer details and must not become the only source of truth.
- Store a stable recipe id, `schemaVersion: 1`, `colorSpace`, `previewMode`, `edgeThreshold`, `haloSuppression`, and `fine`/`medium`/`coarse` scale objects.
- Disabled scales must serialize as `enabled: false` and `amount: 0`; radius is still retained for non-destructive re-enable.
- Preview artifacts use `wavelet_detail.preview.<recipe.id>` ids and include deterministic content hashes.
- Current preview manifests are explicitly `metadata_manifest_only` and `no_pixel_wavelet_render`; this limitation must stay visible until preview/export pixel parity exists.

## UI Placement

- Put the panel in Details after capture sharpening and before local contrast/presence.
- In a mask context, hide global preview artifact controls until layer/mask preview parity exists.
- Use compact scale rows: toggle, amount slider, radius stepper, and a small status/error line.
- Show a non-modal warning when radii are invalid, all amounts are zero while preview is active, or coarse detail plus local contrast exceeds the halo budget.

## Validation

- `bun run check:wavelet-detail` remains the design contract gate.
- Add/keep fixture cases for portrait microtexture, landscape structure, and disabled baseline.
- Preview/export parity is not proven by #128; it belongs to later runtime/e2e work.
- A future UI PR must add a visual smoke path that changes all three bands and parses the resulting recipe dataset with Zod.

## Out Of Scope

- Pixel wavelet rendering quality.
- GPU/CPU preview-export parity.
- Real RAW high-ISO detail quality.
- AI denoise or deblur coupling.
- Layer/mask-local wavelet application.

## Accepted Current Direction

- Three bands are enough for the first reviewable UI/runtime slice.
- The existing schema constraint that radii strictly increase from fine to medium to coarse is correct.
- The existing `metadata_manifest_only` limitation is necessary and prevents overclaiming runtime maturity.
