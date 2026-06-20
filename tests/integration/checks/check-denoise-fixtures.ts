#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  denoiseFixtureManifestSchema,
  parseDenoiseFixtureManifest,
} from '../../../src/schemas/denoiseFixtureSchemas.ts';

const MANIFEST_PATH = 'fixtures/detail/denoise-fixtures.json';
const INVALID_PATH = 'fixtures/detail/invalid-denoise-fixtures.json';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const manifest = parseDenoiseFixtureManifest(await readJson(MANIFEST_PATH));
const invalidCases = await readJson(INVALID_PATH);
const failures = [];

const privateEvidenceIds = new Set(
  manifest.fixtures
    .filter((fixture) => fixture.sourceKind === 'private_raw_placeholder')
    .map((fixture) => fixture.privateRawEvidence.evidenceId),
);

if (!privateEvidenceIds.has('raw-evidence.detail.high-iso-chroma.v1')) {
  failures.push('Missing private high-ISO chroma RAW evidence placeholder.');
}

for (const fixture of manifest.fixtures) {
  if (fixture.sourceKind === 'synthetic_public') {
    const artifactKinds = new Set(fixture.artifacts.map((artifact) => artifact.kind));
    for (const requiredKind of ['synthetic_clean_reference', 'synthetic_noisy_input', 'expected_denoised_reference']) {
      if (!artifactKinds.has(requiredKind)) {
        failures.push(`${fixture.fixtureId}: missing ${requiredKind} artifact.`);
      }
    }
  }

  if (fixture.expectedMetrics.edgePreservationRatio.min < 0.75) {
    failures.push(`${fixture.fixtureId}: edge preservation lower bound is too weak.`);
  }

  if (fixture.expectedMetrics.textureEnergyRatio.min < 0.55) {
    failures.push(`${fixture.fixtureId}: texture energy lower bound is too weak.`);
  }
}

for (const invalidCase of invalidCases) {
  const result = denoiseFixtureManifestSchema.safeParse(invalidCase.payload);
  if (result.success) {
    failures.push(`${invalidCase.case}: expected denoise fixture manifest rejection.`);
  }
}

if (failures.length > 0) {
  console.error('Denoise fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${manifest.fixtures.length} denoise fixtures and ${invalidCases.length} invalid cases.`);
