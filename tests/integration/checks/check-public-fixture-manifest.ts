#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { parsePublicFixtureManifest } from '../../../src/schemas/publicFixtureManifestSchemas.ts';

const manifestPath = 'docs/validation/fixtures/public-fixture-manifest.json';
const manifestJson: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
const manifest = parsePublicFixtureManifest(manifestJson);
const requiredHighIsoFixtureIds = new Set([
  'synthetic.detail.high-iso-flat-shadow.v0',
  'synthetic.detail.high-iso-chroma-edge.v0',
  'synthetic.detail.high-iso-fine-texture.v0',
  'real.detail.high-iso-skin-shadow.v0',
  'real.color.camera-profile-colorchecker.v0',
  'real.color.camera-profile-skin-chart.v0',
  'real.layers.mask-refinement-portrait.v0',
  'real.layers.local-adjustment-landscape.v0',
  'real.hdr.interior-window-bracket.v0',
  'real.hdr.handheld-ghosting-bracket.v0',
  'real.panorama.overlap-urban-row.v0',
  'real.panorama.parallax-foreground.v0',
  'real.focus.macro-bracket-flower.v0',
  'real.focus.product-depth-stack.v0',
  'real.sr.raw-burst-detail.v0',
  'real.sr.pixel-shift-tripod.v0',
]);
const presentFixtureIds = new Set(manifest.entries.map((entry) => entry.fixtureId));
const missingFixtureIds = [...requiredHighIsoFixtureIds].filter((fixtureId) => !presentFixtureIds.has(fixtureId));

if (missingFixtureIds.length > 0) {
  console.error(`Missing required high-ISO fixture IDs: ${missingFixtureIds.join(', ')}`);
  process.exit(1);
}

console.log(`Validated ${manifest.entries.length} public fixture manifest entries.`);
