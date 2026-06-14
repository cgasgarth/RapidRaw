#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { aiPeopleMaskLayerApplyPlanFixtureSchema } from '../src/schemas/aiMaskingSchemas.ts';
import { createAiPeopleMaskLayerApplyPlan } from '../src/utils/aiPeopleMaskLayerPlan.ts';

const fakeProviderFixture = JSON.parse(readFileSync(resolve('fixtures/masks/ai-people-fake-provider.json'), 'utf8'));
const fixture = aiPeopleMaskLayerApplyPlanFixtureSchema.parse(
  JSON.parse(readFileSync(resolve('fixtures/masks/ai-people-layer-apply-plan.json'), 'utf8')),
);

const actualPlan = createAiPeopleMaskLayerApplyPlan(fakeProviderFixture.analysis, fakeProviderFixture.expectedMasks);

if (JSON.stringify(actualPlan) !== JSON.stringify(fixture.expectedPlan)) {
  console.error('AI people-mask layer apply plan mismatch.');
  console.error(JSON.stringify({ actualPlan, expectedPlan: fixture.expectedPlan }, null, 2));
  process.exit(1);
}

console.log(`Validated ${actualPlan.layers.length} fake people-mask layer apply-plan entries.`);
