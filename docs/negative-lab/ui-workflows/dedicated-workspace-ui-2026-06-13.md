# Negative Lab Dedicated Workspace UI

- Date: 2026-06-13
- Issue: #150 `negative-lab(ui): design dedicated negative lab workspace`
- Scope: top-level UI contract for the dedicated Negative Lab workspace.

## Purpose

Negative Lab should be a first-class workspace, not a checkbox inside film
simulation or a modal in the normal editor. It needs a purpose-built surface for
import, frame detection, base/fog sampling, objective inversion, roll
normalization, positive variant creation, and QC review.

This document defines the workspace shell and navigation model. Detailed
sub-flows live in the roll setup/frame queue and QC overlay/readout design docs.

## Workspace Principles

- Treat negative conversion as calibration plus objective inversion before
  creative editing.
- Keep all meaningful actions wired to typed commands or schema-backed dry-run
  records.
- Show warnings and confidence instead of hiding uncertainty behind a one-click
  conversion.
- Keep the original negative immutable and create linked positive variants.
- Make roll-level work fast enough for repeated professional use.
- Avoid Capture One, Lightroom, or Negative Lab Pro branding, claims, assets, or
  copied interaction patterns.

## Primary Areas

The dedicated workspace should contain five persistent areas:

| Area         | Purpose                                      |
| ------------ | -------------------------------------------- |
| Session rail | Source assets, acquisition, process family.  |
| Tool rail    | Crop, sample, curve, normalize, QC tools.    |
| Viewer       | Negative, density, positive, and overlays.   |
| Inspector    | Frame, sample, warning, and provenance data. |
| Frame queue  | Roll thumbnails, statuses, and batch scope.  |

The viewer is the main workspace. Rails and inspectors should feel like tools,
not decorative cards.

## Workspace Modes

The workspace should use a compact mode switcher:

- Setup
- Frame Review
- Base/Fog
- Inversion
- Roll Match
- QC
- Positive Variants

Modes can share the same viewer and frame queue. Switching modes changes the
active tool rail and inspector content, not the entire app shell.

## Command Boundaries

The workspace should be built around the existing Negative Lab command set:

| Mode              | Primary Commands                                               |
| ----------------- | -------------------------------------------------------------- |
| Setup             | `negativeLab.createSession`                                    |
| Frame Review      | `negativeLab.applyFrameCrop`                                   |
| Base/Fog          | `negativeLab.updateBaseSamples`, `negativeLab.estimateBaseFog` |
| Inversion         | `negativeLab.setConversionRecipe`                              |
| Roll Match        | `negativeLab.planRollNormalization`                            |
| QC                | `negativeLab.setFrameQcStatus`                                 |
| Positive Variants | `negativeLab.createPositiveVariant`                            |

Apply actions should require a dry-run plan or explicit preview evidence when
the action mutates session state, sidecars, variants, or export outputs.

## Viewer States

The center viewer should support:

- source negative;
- objective positive preview;
- density map;
- clipping overlay;
- base sample overlay;
- warning overlay;
- before/after split;
- contact sheet overview;
- selected frame crop view.

The first implementation may use fixture images or existing previews, but it
must not claim final-quality conversion until renderer validation exists.

## Inspector Panels

Inspector tabs should be compact:

- Frame
- Samples
- Recipe
- Warnings
- QC
- Provenance

Tabs should expose numeric data and command provenance. For example, the
Samples tab should show accepted/rejected samples, base RGB, base density,
confidence, clipping fraction, and estimate ID. The Recipe tab should show
process profile, curve-set ID/version, output transform, and neutralization
state.

## Frame Queue

The bottom queue should remain visible across modes because roll work depends on
fast frame-to-frame review. It should show:

- frame index;
- crop status;
- warning badge;
- base sample status;
- dry-run status;
- QC status;
- positive variant status;
- anchor/excluded state.

Detailed queue behavior is defined in
`roll-setup-frame-queue-ui-2026-06-13.md`.

## Warning And Confidence Model

The workspace should present warnings by scope:

- session;
- source asset;
- frame;
- sample;
- recipe;
- roll normalization;
- QC proof.

Blocking warnings disable apply actions. Non-blocking warnings remain visible in
the queue, inspector, dry-run results, positive variant provenance, and QC proof
artifacts.

## App-Server Parity

Every user-facing workspace action should have an app-server path:

- agent asks for current session state;
- agent requests a dry-run command;
- app returns preview/QC artifacts and warnings;
- user or policy approves apply;
- app records command, dry-run plan, graph revision, and provenance.

The app-server agent should not use UI automation as the primary edit path. It
should call the same typed command layer as the UI.

## Visual Direction

- Dense, quiet, professional tool surface.
- No hero panels, marketing cards, nested cards, or decorative backgrounds.
- Stable viewer and queue dimensions.
- Small typography in rails and inspectors.
- Icon buttons for common tools.
- Segmented controls for workspace modes and view modes.
- Checkbox/toggle controls for overlays.
- Swatches for channel and warning color readouts.
- Status badges with stable widths.

## Implementation Order

1. Add a feature-flagged workspace route or panel shell.
2. Render fixture-backed session, frame queue, and warning states.
3. Wire read-only schema samples to panels.
4. Add dry-run command builders without apply actions.
5. Add overlay rendering with screenshot tests.
6. Add apply actions once dry-run artifacts and graph revision checks exist.
7. Add positive variant handoff and provenance views.

## Validation Requirements

The first React implementation should include:

- unit tests for mode/state derivation;
- schema sample fixtures for each mode;
- desktop and narrow screenshot coverage;
- keyboard focus coverage for mode switcher, queue, and inspector tabs;
- no overlapping toolbar, queue, or readout text;
- app-server dry-run fixture coverage for command parity;
- visual evidence added to the final goal review HTML page.

## Deferred

Deferred from this design contract:

- final React implementation;
- final renderer quality claims;
- automatic stock detection;
- automatic base/fog detection;
- exact named-stock presets;
- export workflow;
- cloud agent execution.
