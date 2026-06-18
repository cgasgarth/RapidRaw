# Super-Resolution Real-Photo Fixture Manifest

- Date: 2026-06-13
- Issue: #202 `validation(sr): add real photo fixtures`
- Milestone: 13: Super-Resolution
- Scope: planned public fixture manifest entries for real-photo SR validation.

## Purpose

Super-resolution chart fixtures can measure false detail, ringing, and aliasing,
but they do not prove that output remains photographically honest. This slice
adds planned real-photo manifest entries only. It does not add raster payloads,
downloads, generators, CI jobs, or quality thresholds.

## Planned Entries

The public fixture manifest now reserves these real-photo fixture categories:

- `real.sr.skin-hair-portrait.v0`
- `real.sr.foliage-fine-texture.v0`
- `real.sr.fabric-weave.v0`
- `real.sr.architecture-text-signage.v0`
- `real.sr.high-iso-shadow-detail.v0`
- `real.sr.handheld-burst-motion.v0`
- `real.sr.tripod-microshift.v0`
- `real.sr.panorama-overlap-detail.v0`
- `real.sr.raw-burst-detail.v0`
- `real.sr.pixel-shift-tripod.v0`

Each entry is `status: "planned"` and intentionally disables public CI until a
future PR proves redistribution rights, fixture hashes, and review scope.

Issue #1900 also reserves `raw-evidence.super-resolution.raw-burst-detail.v1`
in the private RAW evidence ledger. The #1900 entries are schema/metadata only.
They do not add RAW sequences, SR outputs, alignment maps, source hashes, or
quality claims. A later PR must attach approved rights, hashes, ordered-source
metadata, render artifacts, and review evidence before these entries can count
as runtime SR proof.

## Required Activation Evidence

A future PR may promote a real-photo entry from `planned` only after it supplies:

- source URL or project-owned acquisition record;
- license, copyright owner, contributor, and redistribution decision;
- expected SHA-256, size, dimensions, bit depth, media type, and color profile;
- camera, lens, scanner, burst, tripod, or panorama-overlap metadata as
  applicable;
- representative 100 percent and 200 percent crops;
- baseline upscale comparison and selected SR mode;
- expected warning codes, especially for low confidence, motion, aliasing,
  invented texture, or memory-budget decisions;
- validation command and reviewer sign-off.

## Coverage

The planned set covers the first real-world stress cases from the SR output
policy:

- skin, hair, eyelashes, and portrait microcontrast;
- foliage and repeating organic texture;
- fabric weave and moire risk;
- architecture, text, signage, diagonals, and straight edges;
- high-ISO noise, low-detail regions, and shadow texture;
- handheld burst alignment and rejected-frame behavior;
- tripod micro-shift alignment where detail support should be strongest;
- panorama-overlap SR where seam, parallax, and overlap confidence matter.

## Rights And Storage Policy

These entries are metadata reservations, not approved public fixtures. Until a
fixture has explicit public redistribution rights, it must remain private-CI or
local-only and must not be used for marketing, product-quality claims, public
golden images, or public CI artifacts.

Unknown-rights sample images from the internet may be used only for private
manual exploration. They must not be committed, downloaded by public CI, or
referenced as proof of quality.

## Validation Role

Real-photo fixtures should catch perceptual failures that synthetic charts miss:

- waxy skin or invented hair detail;
- foliage or fabric that becomes periodic, crunchy, or smeared;
- text that appears sharper but gains false strokes or halos;
- high-ISO noise that turns into false texture;
- motion ghosts or alignment seams in burst and overlap inputs;
- color shifts around high-contrast edges.

Chart fixtures still carry the measurable false-detail burden. Real-photo
fixtures decide whether the result is acceptable for a professional editor.

## Validation Commands

Required local checks for this slice:

- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`
