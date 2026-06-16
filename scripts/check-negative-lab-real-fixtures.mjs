#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { negativeLabFixtureManifestV1Schema } from '../packages/rawengine-schema/src/rawEngineSchemas.ts';

const manifestUrl = new URL('../fixtures/negative-lab/negative-lab-real-fixture-manifest.json', import.meta.url);
const manifest = negativeLabFixtureManifestV1Schema.parse(JSON.parse(await readFile(manifestUrl, 'utf8')));

const requiredSlots = [
  'negative_lab.real.pending.c41_color_negative_001',
  'negative_lab.real.pending.bw_silver_negative_001',
  'negative_lab.real.pending.c41_dense_thin_roll_001',
  'negative_lab.real.pending.c41_mixed_lighting_001',
];

const entriesById = new Map(manifest.entries.map((entry) => [entry.fixtureId, entry]));
for (const fixtureId of requiredSlots) {
  const entry = entriesById.get(fixtureId);
  if (entry === undefined) {
    throw new Error(`Missing real Negative Lab fixture slot: ${fixtureId}`);
  }

  if (entry.payloadAccess !== 'metadata_only' || entry.contentHash !== undefined) {
    throw new Error(
      `Pending real Negative Lab fixture must stay metadata-only until payload proof lands: ${fixtureId}`,
    );
  }

  for (const blockedUse of ['density_math_reference', 'roll_consistency', 'profile_measurement']) {
    if (!entry.disallowedValidationUses.includes(blockedUse)) {
      throw new Error(`Pending real Negative Lab fixture must block ${blockedUse}: ${fixtureId}`);
    }
  }

  if (!entry.expectedFixtureWarningCodes.includes('fixture_payload_not_public')) {
    throw new Error(`Pending real Negative Lab fixture must declare missing payload warning: ${fixtureId}`);
  }
}

console.log(`negative lab real fixtures ok (${manifest.entries.length} metadata-only slots, render proof pending)`);
