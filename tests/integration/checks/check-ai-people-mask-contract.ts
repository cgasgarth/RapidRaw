#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { aiPeopleMaskContractFixtureSchema, aiPeopleMaskPartSchema } from '../../../src/schemas/aiMaskingSchemas.ts';
import {
  AI_PEOPLE_MASK_PART_CAPABILITIES,
  getAiPeopleMaskPartCapability,
} from '../../../src/utils/aiPeopleMaskContracts.ts';

const fixture = aiPeopleMaskContractFixtureSchema.parse(
  JSON.parse(readFileSync(resolve('fixtures/masks/ai-people-mask-contract.json'), 'utf8')),
);

if (JSON.stringify(fixture.capabilities) !== JSON.stringify(AI_PEOPLE_MASK_PART_CAPABILITIES)) {
  console.error('AI people-mask capability fixture differs from runtime contract table.');
  process.exit(1);
}

for (const part of aiPeopleMaskPartSchema.options) {
  const runtimeCapability = getAiPeopleMaskPartCapability(part);
  const fixtureCapability = fixture.capabilities.find((capability) => capability.part === part);
  if (fixtureCapability === undefined) {
    console.error(`${part}: missing fixture capability`);
    process.exit(1);
  }

  if (JSON.stringify(runtimeCapability) !== JSON.stringify(fixtureCapability)) {
    console.error(`${part}: runtime people-mask capability mismatch`);
    process.exit(1);
  }
}

const personIds = new Set(fixture.analysis.people.map((person) => person.personId));
for (const artifact of fixture.artifacts) {
  if (artifact.target.personId !== null && !personIds.has(artifact.target.personId)) {
    console.error(`${artifact.artifactId}: target person does not exist in analysis`);
    process.exit(1);
  }
}

console.log(
  `Validated ${fixture.capabilities.length} AI people-mask part contracts, ${fixture.analysis.people.length} people, and ${fixture.artifacts.length} artifacts.`,
);
