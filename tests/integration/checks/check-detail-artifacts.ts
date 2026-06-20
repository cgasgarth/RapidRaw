#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  detailArtifactManifestSchema,
  parseDetailArtifactManifest,
} from '../../../src/schemas/detailValidationSchemas.ts';

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

const manifest = parseDetailArtifactManifest(await readJson('fixtures/detail/detail-artifacts.json'));
const invalidCases = z
  .array(z.object({ case: z.string().min(1), payload: z.unknown() }).strict())
  .parse(await readJson('fixtures/detail/invalid-detail-artifacts.json'));
const failures: string[] = [];

const requiredKinds = new Set(['metric_report', 'private_raw_placeholder', 'synthetic_after', 'synthetic_before']);
const coveredKinds = new Set(manifest.artifacts.map((artifact) => artifact.kind));

for (const kind of requiredKinds) {
  if (!coveredKinds.has(kind)) {
    failures.push(`Missing detail artifact kind: ${kind}.`);
  }
}

for (const artifact of manifest.artifacts) {
  if (artifact.capabilityState === 'cpu_reference_only' && !artifact.limitations.includes('ui_api_wiring')) {
    failures.push(`${artifact.artifactId}: CPU reference artifacts must not imply UI/API wiring.`);
  }
}

for (const invalidCase of invalidCases) {
  const result = detailArtifactManifestSchema.safeParse(invalidCase.payload);
  if (result.success) {
    failures.push(`${invalidCase.case}: expected detail artifact rejection.`);
  }
}

if (failures.length > 0) {
  console.error('Detail artifact validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${manifest.artifacts.length} detail artifact entries and ${invalidCases.length} invalid cases.`);
