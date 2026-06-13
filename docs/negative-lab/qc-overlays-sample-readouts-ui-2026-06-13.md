# Negative Lab QC Overlays And Sample Readouts UI

- Date: 2026-06-13
- Issue: #268 `negative-lab(ui): add QC overlays and sample readouts design`
- Scope: UI design contract for Negative Lab overlays, sample readouts, QC
  review states, and validation evidence.

## Purpose

Negative Lab should make conversion quality inspectable. A visually plausible
positive preview is not enough; the UI must show where samples came from, which
regions were rejected, what warnings were generated, and which numeric metrics
support the current dry-run or applied result.

This document defines the first UI contract for overlays and readouts. It does
not implement React components, pixel sampling, or rendered screenshots.

## Overlay Layers

The viewer should support independently toggled overlay layers:

| Overlay Layer    | Purpose                                      | Existing Contract  |
| ---------------- | -------------------------------------------- | ------------------ |
| Frame boundary   | Show accepted crop and border confidence.    | `frame_boundary`   |
| Base sample      | Show accepted base/fog sample regions.       | `base_sample`      |
| Rejected sample  | Show excluded sample regions and reason.     | follow-up schema   |
| Density sample   | Show sampled density/patch readouts.         | `density_sample`   |
| Clipping warning | Show clipped or near-clipped pixels/regions. | `clipping_warning` |
| Warning region   | Show warning-specific geometry.              | `warning_region`   |
| Curve response   | Show selected curve-set response location.   | follow-up schema   |

The v1 schema already includes `NegativeLabQcOverlayV1` with geometry,
severity, overlay kind, warning codes, label, and frame ID. New overlay kinds
such as rejected samples and curve response plots should be added only when the
first renderer or screenshot tests need typed payloads.

## Readout Panel

Selecting a frame, overlay, or sample should populate a compact readout panel.
The panel should use stable rows and small channel swatches for RGB/luminance
values.

Recommended readouts:

- frame ID and source file ID;
- crop confidence and border state;
- overlay ID and kind;
- sample ID;
- sample role;
- accepted/rejected state;
- rejection reason;
- base RGB estimate;
- base density estimate;
- clipping fraction;
- base confidence score;
- density P01/P50/P99;
- selected process profile;
- selected curve-set ID and version;
- roll density delta;
- white-balance delta;
- output clipping fraction;
- warning codes and highest severity;
- dry-run plan ID;
- graph revision.

Unstable metrics can initially come from
`negativeLabDryRunResultV1.numericMetrics`. Metrics that become persistent UI
contracts should move into typed schemas before renderer or app-server tools
depend on them.

## Viewer Interactions

The QC viewer should support:

- pan and zoom;
- fit frame;
- compare source negative, objective positive, density map, and clipping view;
- toggle overlay layers;
- select overlay geometry;
- jump from warning row to overlay region;
- jump from frame queue row to viewer frame;
- show before/after split for dry-run versus applied positive;
- copy readout JSON for debugging;
- open provenance for applied variants.

Overlay toggles should use checkboxes or icon toggles with tooltips. Compare
modes should use segmented controls. Zoom, pan, fit, and split should use icon
buttons.

## QC Review States

Frame QC state should remain explicit:

| State                    | Meaning                                           |
| ------------------------ | ------------------------------------------------- |
| `unreviewed`             | No human or agent QC decision exists.             |
| `approved`               | Frame is accepted without blocking warnings.      |
| `approved_with_warnings` | Frame is usable but warning evidence remains.     |
| `rejected`               | Frame should not be exported or batch-applied.    |
| `excluded_from_batch`    | Frame is intentionally outside the current batch. |

Changing QC state should call `negativeLab.setFrameQcStatus`. The UI should
record review notes for rejected frames and approved-with-warning frames once
the command schema supports notes.

## Warning Rules

Warnings should be visible in three places:

- frame queue badge;
- viewer overlay/readout panel;
- QC proof summary.

Blocking warnings disable apply/export actions. Non-blocking warnings remain
visible in proof artifacts and positive-variant provenance. Warning rows should
include scope, severity, evidence, affected frame IDs, and whether automation is
blocked.

## App-Server Handoff

Agent-driven image editing must be able to inspect the same QC evidence as the
UI. App-server tools should be able to request:

- QC proof summary;
- overlay list by frame;
- numeric metrics by frame;
- warning list by scope;
- preview artifact handles;
- dry-run versus applied command provenance.

Agent tools should not infer quality only from the displayed bitmap. They should
use typed warning and metric payloads when deciding whether to apply, reject, or
ask for review.

## Visual Design Rules

- Keep overlays high contrast but not opaque enough to hide image detail.
- Use severity color sparingly: info, warning, error, blocked.
- Use channel swatches for RGB/luminance readouts.
- Keep numeric readouts aligned in a table-like panel.
- Keep overlay labels short and avoid covering the sample region.
- Keep queue badges and readout rows stable so values do not resize the layout.
- Do not use decorative cards, hero sections, or oversized explanatory text in
  the tool surface.

## Validation Requirements

Before the first React implementation PR is complete, it should include:

- deterministic fixture states for no overlays, accepted samples, rejected
  samples, clipping warnings, and mixed severity warnings;
- unit tests for overlay grouping and warning badge derivation;
- screenshot tests for desktop and narrow layouts;
- keyboard selection tests for overlay and warning navigation;
- canvas-pixel checks once overlays draw over real image buffers;
- fixture-backed readout snapshots for numeric metrics;
- app-server dry-run fixture showing QC proof payload access.

## Deferred

Deferred from this design PR:

- actual overlay rendering;
- new overlay schema kinds;
- pixel sampling implementation;
- screenshot baselines;
- final color or density-map rendering;
- agent quality scoring;
- export gating UI.

Those should land as separate PRs once the schema and renderer paths are ready.
