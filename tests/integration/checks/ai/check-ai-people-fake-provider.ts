#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { aiPeopleMaskFakeProviderFixtureSchema } from '../../../../src/schemas/masks/aiMaskingSchemas.ts';
import { renderFakeAiPeopleMask } from '../../../../src/utils/ai/aiPeopleMaskFakeProvider.ts';

const fixtureJson: unknown = JSON.parse(
  readFileSync(resolve('fixtures/masks/ai/ai-people-fake-provider.json'), 'utf8'),
);
const fixture = aiPeopleMaskFakeProviderFixtureSchema.parse(fixtureJson);

for (const expectedMask of fixture.expectedMasks) {
  const actualMask = renderFakeAiPeopleMask(
    fixture.analysis,
    expectedMask.target,
    expectedMask.width,
    expectedMask.height,
  );

  if (JSON.stringify(actualMask) !== JSON.stringify(expectedMask)) {
    console.error(`${expectedMask.artifactId}: fake people-mask output mismatch`);
    console.error(JSON.stringify({ actualMask, expectedMask }, null, 2));
    process.exit(1);
  }
}

console.log(`Validated ${fixture.expectedMasks.length} deterministic fake people-mask outputs.`);
