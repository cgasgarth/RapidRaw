#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  detailStageOrderManifestSchema,
  parseDetailStageOrderManifest,
} from '../../../src/schemas/detailValidationSchemas.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const manifest = parseDetailStageOrderManifest(await readJson('fixtures/detail/artifacts/detail-stage-order.json'));
const invalidCases = await readJson('fixtures/detail/invalid/artifacts/invalid-detail-stage-order.json');
const failures = [];

const requiredSequence = [
  'raw_decode',
  'demosaic',
  'scene_linear_denoise',
  'scene_linear_deblur',
  'capture_sharpen',
  'local_contrast',
  'tone_display_transform',
  'output_sharpen',
  'export_encode',
];
const stageOrders = new Map(manifest.stages.map((stage) => [stage.stage, stage.order]));

for (let index = 1; index < requiredSequence.length; index += 1) {
  const before = stageOrders.get(requiredSequence[index - 1]);
  const after = stageOrders.get(requiredSequence[index]);
  if (before === undefined || after === undefined || before >= after) {
    failures.push(`${requiredSequence[index - 1]} must precede ${requiredSequence[index]}.`);
  }
}

for (const invalidCase of invalidCases) {
  const result = detailStageOrderManifestSchema.safeParse(invalidCase.payload);
  if (result.success) {
    failures.push(`${invalidCase.case}: expected detail stage order rejection.`);
  }
}

if (failures.length > 0) {
  console.error('Detail stage order validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${manifest.stages.length} detail stage-order entries and ${invalidCases.length} invalid cases.`);
