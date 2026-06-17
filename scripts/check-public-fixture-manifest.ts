#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { parsePublicFixtureManifest } from '../src/schemas/publicFixtureManifestSchemas.ts';

const manifestPath = 'docs/validation/public-fixture-manifest.json';
const manifestJson: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
const manifest = parsePublicFixtureManifest(manifestJson);
const requiredHighIsoFixtureIds = new Set([
  'synthetic.detail.high-iso-flat-shadow.v0',
  'synthetic.detail.high-iso-chroma-edge.v0',
  'synthetic.detail.high-iso-fine-texture.v0',
  'real.detail.high-iso-skin-shadow.v0',
]);
const presentFixtureIds = new Set(manifest.entries.map((entry) => entry.fixtureId));
const missingFixtureIds = [...requiredHighIsoFixtureIds].filter((fixtureId) => !presentFixtureIds.has(fixtureId));

if (missingFixtureIds.length > 0) {
  console.error(`Missing required high-ISO fixture IDs: ${missingFixtureIds.join(', ')}`);
  process.exit(1);
}

console.log(`Validated ${manifest.entries.length} public fixture manifest entries.`);
