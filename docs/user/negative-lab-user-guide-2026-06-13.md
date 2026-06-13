# Negative Lab User Guide

- Date: 2026-06-13
- Issue: #161 `docs(negative-lab): add user guide for negative workflow`
- Status: product workflow guide for the planned Negative Lab surface.

## Purpose

Negative Lab is RawEngine's dedicated workspace for converting photographed,
scanned, or lab-rendered film negatives into editable positive images. The
workflow is designed around repeatable roll processing: identify the source,
split frames, sample film base/fog, choose a conversion recipe, normalize a roll,
create positive variants, and review QC proof artifacts before export.

## Supported Starting Points

The first supported v1 process families are:

- C-41 color negative;
- black-and-white silver negative.

Other processes, creative/redscale negatives, ECN-2, chromogenic
black-and-white, slide helper workflows, and exact named-stock profiles require
additional profile, fixture, and legal review work before they are first-class
workflows.

## Recommended Workflow

1. Create a Negative Lab session.

   Import a single frame, roll, or contact sheet. Record the source input mode,
   pixel basis, acquisition profile, process family, and warnings. Prefer RAW or
   16-bit TIFF inputs when available. Lab JPEGs can be useful for organization,
   but they should show low confidence and lossy-input warnings.

2. Review frame detection.

   For contact sheets or strips, review detected frame boundaries, crop
   confidence, border state, and rejected candidates. Accept detected crops only
   when the visible film border and frame edges are plausible. Use manual
   overrides when a detected crop cuts into the frame or includes sprockets,
   rebate marks, dust, or scanner borders that will confuse base sampling.

3. Sample film base and fog.

   Select clean unexposed film-base regions. Avoid rebate text, sprockets,
   scratches, dust, light leaks, clipped channels, and uneven illumination. For a
   roll, use shared base samples when the scan setup is consistent. Use per-frame
   overrides when lighting, scanner correction, or border visibility changes.

4. Set the conversion recipe.

   Pick a generic built-in preset or process profile as a starting point. V1
   generic presets do not claim exact stock emulation. The objective conversion
   recipe should stay separate from later creative looks, film simulations,
   grain, halation, or output styling.

5. Dry-run roll normalization.

   Choose anchor frames, preview density and white-balance deltas, and inspect
   which frames fall outside tolerance. Do not apply a batch normalization plan
   when anchor frames are unrepresentative, rejected frames are included, or roll
   consistency warnings are unexplained.

6. Create positive variants.

   Apply the approved dry-run plan to create positive variants. Positive
   variants should retain provenance: source frame, source hash, base samples,
   conversion command, dry-run plan, output transform, warnings, and graph
   revision.

7. Review QC proof artifacts.

   Use contact sheets, overlays, sample readouts, clipping overlays, warning
   badges, and roll consistency metrics to approve, approve with warnings, reject,
   or exclude frames from export.

## Presets And Stock Names

RawEngine's built-in Negative Lab presets are generic starting points. Exact
stock names, manufacturer names, measured project profiles, and licensed profile
claims must resolve through the preset metadata policy catalog before appearing
in user-facing UI or app-server tools.

If a preset or profile cannot prove its naming, fixture, license, and review
requirements, treat it as blocked pending review.

## Warnings To Treat Seriously

Pause and inspect the frame or roll when RawEngine reports:

- unknown input mode or pixel basis;
- assumed display profile;
- display-referred or lab-rendered input;
- lossy input or low bit depth;
- suspected lab correction, auto exposure, auto color, or auto contrast;
- missing visible base, cropped border, or low frame-detection confidence;
- clipped base channel or uneven illumination;
- mixed input modes inside one roll;
- profile mismatch or low acquisition confidence.

## Automation And App-Server Tools

The same workflow must be available through local app-server tools. Agent-driven
editing should use dry-run commands first, show expected session/frame changes,
return preview or QC artifacts, and require approval before mutating sidecars,
positive variants, or export outputs.

## Current Limitations

This guide describes the intended workflow contract. Some UI panels, exact
rendering math, measured profiles, named-stock presets, and real fixture-driven
quality gates are still being implemented through separate issues and pull
requests. Treat current schema artifacts as the source of truth for what is
machine-validated today.
