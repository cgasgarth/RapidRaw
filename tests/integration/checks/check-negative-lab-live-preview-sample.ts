#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  buildNegativeLabBaseSamplePreviewProof,
  type NegativeLabBaseSamplePreviewProof,
} from '../../../src/utils/negativeLabBaseSampleCommandBridge.ts';
import { negativeLabUpdateBaseSamplesCommandV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const REPORT_PATH = 'docs/validation/negative-lab-live-preview-sample-2026-06-21.json';
const update = process.argv.includes('--update');

const hashSchema = z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u);
const reportSchema = z
  .object({
    commandType: z.literal('negativeLab.updateBaseSamples'),
    decodedPreviewChanged: z.literal(true),
    issue: z.literal(2889),
    previewAfterHash: hashSchema,
    previewBeforeHash: hashSchema,
    previewChanged: z.literal(true),
    previewRevision: z.literal(7),
    sampleEditMode: z.literal('replace'),
    sampleSource: z.literal('custom_rect'),
    schemaVersion: z.literal(1),
    validationBoundary: z.literal('deterministic_svg_preview_and_typed_command_not_full_color_science'),
    warningCodes: z.array(z.enum(['clipped_base_channel', 'low_acquisition_confidence', 'uneven_illumination'])),
  })
  .strict();

const buildPreviewDataUrl = (label: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg><rect fill="#111"/><text>${label}</text></svg>`)}`;

const decodePreviewDataUrl = (url: string) => decodeURIComponent(url.replace('data:image/svg+xml,', ''));

const previewBeforeUrl = buildPreviewDataUrl('baseFogSample:null red=1 green=1 blue=1');
const previewAfterUrl = buildPreviewDataUrl('baseFogSample:custom red=1.07 green=0.96 blue=1.18');
const proof: NegativeLabBaseSamplePreviewProof = buildNegativeLabBaseSamplePreviewProof(
  {
    estimate: {
      baseDensity: [0.145, 0.238, 0.356],
      baseRgb: [0.716, 0.578, 0.441],
      blueWeight: 1.18,
      confidence: 0.91,
      greenWeight: 0.96,
      redWeight: 1.07,
    },
    frameId: 'frame_1',
    imagePath: '/fixtures/negative-lab/synthetic-color-negative-001.tif',
    previewBeforeUrl,
    sampleRect: {
      height: 0.18,
      width: 0.18,
      x: 0.25,
      y: 0.25,
    },
    source: 'custom_rect',
  },
  previewAfterUrl,
  {
    densityRange: 0.211,
    dominantChannel: 'blue',
    status: 'strong_cast',
  },
  7,
);

negativeLabUpdateBaseSamplesCommandV1Schema.parse(proof.command);

const decodedBefore = decodePreviewDataUrl(previewBeforeUrl);
const decodedAfter = decodePreviewDataUrl(previewAfterUrl);
if (decodedBefore === decodedAfter) {
  throw new Error('Negative Lab live preview proof did not change decoded preview content.');
}

const expectedReport = reportSchema.parse({
  commandType: proof.command.commandType,
  decodedPreviewChanged: decodedBefore !== decodedAfter,
  issue: 2889,
  previewAfterHash: proof.previewAfterHash,
  previewBeforeHash: proof.previewBeforeHash,
  previewChanged: proof.previewChanged,
  previewRevision: proof.previewRevision,
  sampleEditMode: proof.command.parameters.sampleEditMode,
  sampleSource: proof.sampleSource,
  schemaVersion: 1,
  validationBoundary: 'deterministic_svg_preview_and_typed_command_not_full_color_science',
  warningCodes: proof.warningCodes,
});
const expectedJson = `${JSON.stringify(expectedReport, null, 2)}\n`;

if (update) {
  await writeFile(REPORT_PATH, expectedJson);
  console.log('negative lab live preview sample updated');
  process.exit(0);
}

const actualReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
if (JSON.stringify(actualReport) !== JSON.stringify(expectedReport)) {
  throw new Error(`Negative Lab live preview sample proof is stale. Run bun ${import.meta.path} --update`);
}

console.log(`negative lab live preview sample ok (${expectedReport.sampleSource}, ${expectedReport.previewAfterHash})`);
