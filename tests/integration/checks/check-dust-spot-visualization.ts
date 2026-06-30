#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  dustSpotVisualizationFixtureSchema,
  dustSpotVisualizationSettingsSchema,
} from '../../../src/schemas/dustSpotVisualizationSchemas.ts';
import { ADJUSTMENT_GROUPS, DetailsAdjustment, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

const invalidDustSpotVisualizationCaseSchema = z
  .object({
    case: z.string().min(1),
    payload: z.unknown(),
  })
  .strict();

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));

const manifest = dustSpotVisualizationFixtureSchema.parse(
  await readJson('fixtures/detail/artifacts/dust-spot-visualization.json'),
);
const invalidCases = z
  .array(invalidDustSpotVisualizationCaseSchema)
  .parse(await readJson('fixtures/detail/invalid/artifacts/invalid-dust-spot-visualization.json'));
const failures: Array<string> = [];
const requiredAdjustmentKeys: Array<DetailsAdjustment> = [
  DetailsAdjustment.DustSpotOverlayEnabled,
  DetailsAdjustment.DustSpotSensitivity,
  DetailsAdjustment.DustSpotMinRadiusPx,
];

if (!manifest.cases.some((testCase) => testCase.mode === 'candidate_overlay')) {
  failures.push('Dust visualization fixtures must include candidate overlay mode.');
}

if (!manifest.cases.some((testCase) => testCase.falsePositiveGuards.includes('film_grain'))) {
  failures.push('Dust visualization fixtures must guard film-grain false positives.');
}

for (const invalidCase of invalidCases) {
  const result = dustSpotVisualizationSettingsSchema.safeParse(invalidCase.payload);
  if (result.success) {
    failures.push(`${invalidCase.case}: expected invalid dust visualization settings.`);
  }
}

if (INITIAL_ADJUSTMENTS.dustSpotOverlayEnabled !== false) {
  failures.push('Dust overlay must be disabled by default.');
}

if (INITIAL_ADJUSTMENTS.dustSpotSensitivity !== 50) {
  failures.push('Default dust sensitivity must stay at 50.');
}

if (INITIAL_ADJUSTMENTS.dustSpotMinRadiusPx !== 2) {
  failures.push('Default dust minimum radius must stay at 2 px.');
}

const detailGroupKeys = new Set(ADJUSTMENT_GROUPS.details.flatMap((group) => group.keys));
for (const key of requiredAdjustmentKeys) {
  if (!detailGroupKeys.has(key)) {
    failures.push(`${key} must be included in detail copy/paste groups.`);
  }
}

if (failures.length > 0) {
  console.error('Dust spot visualization validation failed.');
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`Validated ${manifest.cases.length} dust visualization cases and ${invalidCases.length} invalid cases.`);
