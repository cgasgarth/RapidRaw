#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  rawEngineColorPipelineContextV1Schema,
  toneColorCommandEnvelopeV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleToneColorCommandEnvelopeV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { headlessRenderRequestSchema } from '../../../src/schemas/headlessRenderCommandSchemas.ts';
import { rawOpenEditExportProofRequestSchema } from '../../../src/schemas/rawOpenEditExportCommandSchemas.ts';
import { colorRuntimeProofFixtureSchema } from '../../../scripts/lib/color-runtime-proof.ts';
import { curvesLevelsRuntimeProofFixtureSchema } from '../../../scripts/lib/curves-levels-runtime-proof.ts';

const failures: string[] = [];

assertPipeline('schema sample tone/color command', sampleToneColorCommandEnvelopeV1.colorPipeline);

const headlessRequest = headlessRenderRequestSchema.parse(
  await readJson('fixtures/validation/headless-render-command-request.json'),
);
assertPipeline('headless render command request', headlessRequest.command.colorPipeline);

const rawOpenEditExportRequest = rawOpenEditExportProofRequestSchema.parse(
  await readJson('fixtures/validation/raw-open-edit-export-proof-request.json'),
);
assertPipeline('RAW open/edit/export command request', rawOpenEditExportRequest.editCommand.colorPipeline);

const whiteBalanceToneProof = colorRuntimeProofFixtureSchema.parse(
  await readJson('fixtures/color/white-balance-tone-runtime-proof.json'),
);
assertPipeline('white balance + tone runtime proof', whiteBalanceToneProof.toneCommand.colorPipeline);

const curvesLevelsProof = curvesLevelsRuntimeProofFixtureSchema.parse(
  await readJson('fixtures/color/curves-levels-runtime-proof.json'),
);
assertPipeline(
  'curves runtime proof',
  toneColorCommandEnvelopeV1Schema.parse(curvesLevelsProof.curveCommand).colorPipeline,
);
assertPipeline(
  'levels runtime proof',
  toneColorCommandEnvelopeV1Schema.parse(curvesLevelsProof.levelsCommand).colorPipeline,
);

if (failures.length > 0) {
  console.error('Working-space contract validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('working-space contract ok (6 payloads)');

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

function assertPipeline(name: string, value: unknown): void {
  const result = rawEngineColorPipelineContextV1Schema.safeParse(value);
  if (!result.success) {
    failures.push(`${name}: missing explicit working-space/display-transform metadata.`);
  }
}
