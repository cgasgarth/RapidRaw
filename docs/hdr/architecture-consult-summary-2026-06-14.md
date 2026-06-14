# HDR Architecture Consult Summary

Date: 2026-06-14
Issue: #162 `consult(hdr): get HDR architecture review`
Scope: Milestone 10 HDR merge architecture review
Source: RapidRaw ChatGPT project consult with GitHub repo context attached
Status: advisory architecture review; no renderer-quality claim

## Consult Inputs

The consult reviewed the RawEngine/RapidRaw HDR milestone, current
computational merge contracts, existing RapidRAW HDR UI and Tauri commands, the
schema-first app-server direction, and the requirement for editable
Capture One/Lightroom-class HDR merge output.

## Current Implementation Read

RapidRAW already has a runtime-capable legacy HDR path, but it should not be
treated as the final RawEngine architecture:

- The existing path is direct Tauri UI command plumbing, not a typed command-bus
  contract.
- The result is stored as an in-memory HDR result for preview/save rather than a
  durable derived artifact.
- It lacks dry-run/apply separation, accepted plan hashes, provenance,
  invalidation, bracket metadata, alignment summaries, deghosting artifacts, and
  explicit app-server tool contracts.
- It can be used as baseline behavior evidence, but not as proof that the final
  editable HDR milestone is complete.

## Accepted Direction

- Treat HDR as a first-class derived computational artifact, not as a rendered
  export or temporary preview.
- Keep HDR inside the computational merge family and extend it with
  HDR-specific artifact metadata where generic merge contracts are not enough.
- Require dry-run before apply. Apply must require an accepted dry-run plan id,
  accepted plan hash, current source graph revisions, and explicit user approval
  when driven by an agent.
- Persist output as an editable source in the normal pipeline with source refs,
  content hashes, graph revisions, backend/version, output color state,
  highlight metrics, warning/block codes, and stale-state rules.
- Model bracket detection, alignment, merge weighting, and deghosting as
  inspectable stages with metrics and artifacts rather than hidden booleans.
- Keep first runtime validation deterministic and small before claiming
  professional image quality on real RAW brackets.

## Required Contracts

- `HdrMergeArtifactV1` for durable merge results, output handles, source state,
  stale state, and validation summary.
- Bracket detection payload with exposure EV, capture time, camera/lens IDs,
  detection method, confidence, warnings, and block reasons.
- Alignment summary with per-source transforms, overlap, crop loss, RMS error,
  confidence, and rejected-source reasons.
- Merge weighting summary covering highlight recovery, black/noise handling,
  saturation policy, and source contribution.
- Deghosting summary with mode, motion risk, mask artifact refs, manual-review
  requirements, and protected regions.
- Output color-state contract that distinguishes scene-linear merge data,
  display preview data, tone-mapped previews, and exported files.
- App-server tool contracts that expose dry-run/apply behavior without allowing
  unreviewed destructive or low-confidence HDR apply.

## Recommended Implementation Order

1. Audit existing RapidRAW HDR commands and runtime behavior.
2. Add the HDR merge artifact schema and sample payload validation.
3. Add tiny deterministic synthetic bracket fixtures.
4. Add bracket detection with exposure grouping and block/warning codes.
5. Add CPU alignment smoke tests with measurable transforms.
6. Add merge weighting metrics and highlight-recovery validation.
7. Add deghosting strategy with mask artifacts and manual-review states.
8. Make merged output an editable source with durable provenance and stale-state
   invalidation.
9. Add UI dry-run review and apply surfaces.
10. Add app-server HDR tools routed through the typed command bus.
11. Add real RAW fixture validation and performance gates before image-quality
    claims.

## Validation Policy

Schema-only PRs must state they are schema-only and run:

- `bun run schema:check`
- `bun run check:unsafe-casts`
- `bun run format:check`
- `git diff --check`

Runtime smoke PRs must add executable proof for the exact claimed stage. A
bracket detector must prove detection and rejection behavior; alignment must
prove transforms and error metrics; merge weighting must prove numeric exposure
and highlight behavior; deghosting must prove masks and manual-review states.

Real RAW quality claims require source fixture provenance, generated artifacts,
before/after crops, highlight/shadow metrics, timing, memory, and review notes.
Legacy `merge_hdr` preview behavior alone is not sufficient proof.

## Risk Register

| Risk                                     | Impact                                                | Mitigation                                                                 |
| ---------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Legacy preview path becomes final design | Non-durable output, weak provenance, agent mismatch   | Route final work through typed artifacts, dry-run/apply, and stale state.  |
| Bracket mis-grouping                     | Wrong source set or broken exposure coverage          | Metadata grouping, EV checks, capture-time windows, and block codes.       |
| Alignment errors                         | Softness, edge doubling, crop loss                    | Per-source metrics, reject reasons, fixture transforms, and visual crops.  |
| Motion ghosting                          | Duplicate subjects and user-visible artifacts         | Motion risk, deghost masks, protected regions, and manual-review state.    |
| Highlight recovery overclaiming          | Clipped or unnatural output presented as high quality | Numeric highlight metrics and real bracket validation before claims.       |
| Agent over-application                   | Local agent applies unsafe HDR result                 | Local-only tools, dry-run first, accepted plan hash, warnings, approval.   |
| Memory and runtime blowups               | macOS laptop instability                              | Small fixtures first, performance smoke, tiling/streaming follow-up gates. |
| Color-state ambiguity                    | Display previews treated as editable scene data       | Explicit output color-state contract and tone-mapping separation.          |

## Follow-Up Issues

- #163 `hdr(audit): audit existing RapidRAW HDR merge`
- #164 `hdr(schema): define HDR merge artifact schema`
- #165 `hdr(brackets): add bracket detection`
- #166 `hdr(align): add auto alignment tests`
- #167 `hdr(merge): add merge weighting strategy`
- #168 `hdr(deghost): add deghosting strategy`
- #169 `validation(hdr): add HDR fixture set`
- #170 `hdr(pipeline): make merged output editable source`
- #171 `ui(hdr): add HDR merge UI`
- #172 `api(hdr): add HDR merge API tools`
- #173 `validation(hdr): add HDR performance tests`

## Decision

HDR implementation should proceed from contract and deterministic proof toward
runtime quality. The existing RapidRAW HDR path is useful baseline evidence, but
RawEngine completion requires durable editable artifacts, stage metrics,
provenance, invalidation, app-server routing, and real-image validation before
professional image-quality claims.
