#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  aiPeopleMaskFakeProviderFixtureSchema,
  aiPeopleMaskLayerApplyPlanFixtureSchema,
} from '../../../../src/schemas/aiMaskingSchemas.ts';
import { createAiPeopleMaskLayerApplyPlan } from '../../../../src/utils/ai/aiPeopleMaskLayerPlan.ts';

const fakeProviderFixtureJson: unknown = JSON.parse(
  readFileSync(resolve('fixtures/masks/ai/ai-people-fake-provider.json'), 'utf8'),
);
const fakeProviderFixture = aiPeopleMaskFakeProviderFixtureSchema.parse(fakeProviderFixtureJson);
const fixtureJson: unknown = JSON.parse(
  readFileSync(resolve('fixtures/masks/ai/ai-people-layer-apply-plan.json'), 'utf8'),
);
const fixture = aiPeopleMaskLayerApplyPlanFixtureSchema.parse(fixtureJson);

const actualPlan = createAiPeopleMaskLayerApplyPlan(fakeProviderFixture.analysis, fakeProviderFixture.expectedMasks);

if (JSON.stringify(actualPlan) !== JSON.stringify(fixture.expectedPlan)) {
  console.error('AI people-mask layer apply plan mismatch.');
  console.error(JSON.stringify({ actualPlan, expectedPlan: fixture.expectedPlan }, null, 2));
  process.exit(1);
}

console.log(`Validated ${actualPlan.layers.length} fake people-mask layer apply-plan entries.`);
