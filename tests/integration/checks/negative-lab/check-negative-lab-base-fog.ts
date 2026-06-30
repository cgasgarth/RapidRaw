#!/usr/bin/env bun
// @ts-check

import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { negativeLabUpdateBaseSamplesCommandV1Schema } from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { negativeBaseFogEstimateSchema } from '../../../../src/schemas/negative-lab/negativeLabPresetCatalogSchemas.ts';
import { buildNegativeLabDensitometerRouteResult } from '../../../../src/utils/negativeLabAppServerRoutes.ts';
import {
  buildNegativeLabBaseSamplePreviewProof,
  buildNegativeLabBaseSampleWarningCodes,
  classifyNegativeLabBaseSampleConfidence,
  type NegativeLabBaseSamplePreviewProofContext,
} from '../../../../src/utils/negativeLabBaseSampleCommandBridge.ts';
import { buildNegativeBaseFogDensitometerReadout } from '../../../../src/utils/negativeLabDensitometer.ts';

const proofPath = new URL(
  '../../../../fixtures/negative-lab/negative-lab-synthetic-fixture-proof.json',
  import.meta.url,
);
const syntheticProofSchema = z
  .object({
    cases: z
      .array(
        z
          .object({
            baseFogRgb: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
            fixtureId: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

const normalizedSampleRect = {
  height: 0.6,
  width: 0.12,
  x: 0.02,
  y: 0.2,
};

const approxEqual = (left, right, epsilon = 0.000001) => Math.abs(left - right) <= epsilon;

const buildEstimateFromBaseFogRgb = (baseRgb, confidence) => {
  const baseDensity = baseRgb.map((channel) => -Math.log10(channel));
  const meanDensity = baseDensity.reduce((sum, density) => sum + density, 0) / baseDensity.length;
  const toWeight = (density) => Math.min(2, Math.max(0.5, meanDensity / Math.max(0.001, density)));

  return negativeBaseFogEstimateSchema.parse({
    baseDensity,
    baseRgb,
    blueWeight: toWeight(baseDensity[2]),
    confidence,
    greenWeight: toWeight(baseDensity[1]),
    redWeight: toWeight(baseDensity[0]),
  });
};

const buildPreviewContext = (estimate, fixtureId, source): NegativeLabBaseSamplePreviewProofContext => ({
  estimate,
  frameId: fixtureId,
  imagePath: `/fixtures/negative-lab/${fixtureId}.tif`,
  previewBeforeUrl: `data:image/svg+xml,${encodeURIComponent(`<svg><text>${fixtureId}:before</text></svg>`)}`,
  sampleRect: normalizedSampleRect,
  source,
});

const rawProof = JSON.parse(readFileSync(proofPath, 'utf8'));
const proof = syntheticProofSchema.parse({
  cases: rawProof.cases
    .filter((candidate) => Array.isArray(candidate.baseFogRgb))
    .map((candidate) => ({
      baseFogRgb: candidate.baseFogRgb,
      fixtureId: candidate.fixtureId,
    })),
});
const grayCase = proof.cases.find(
  (candidate) => candidate.fixtureId === 'negative_lab.synthetic.gray_ramp_base_fog_001',
);
const clippedCase = proof.cases.find(
  (candidate) => candidate.fixtureId === 'negative_lab.synthetic.clipped_channel_warning_001',
);

if (grayCase === undefined) {
  throw new Error('Missing gray ramp base/fog fixture case.');
}
if (clippedCase === undefined) {
  throw new Error('Missing clipped-channel base/fog fixture case.');
}

const balancedEstimate = buildEstimateFromBaseFogRgb(grayCase.baseFogRgb, 0.91);
const clippedEstimate = buildEstimateFromBaseFogRgb(clippedCase.baseFogRgb, 0.54);
const balancedDensitometer = buildNegativeBaseFogDensitometerReadout(balancedEstimate);
const clippedDensitometer = buildNegativeBaseFogDensitometerReadout(clippedEstimate);
const balancedRouteResult = buildNegativeLabDensitometerRouteResult({ baseFogEstimate: balancedEstimate });
const clippedRouteResult = buildNegativeLabDensitometerRouteResult({ baseFogEstimate: clippedEstimate });
const balancedPreviewProof = buildNegativeLabBaseSamplePreviewProof(
  buildPreviewContext(balancedEstimate, grayCase.fixtureId, 'preset_rect'),
  `data:image/svg+xml,${encodeURIComponent(`<svg><text>${grayCase.fixtureId}:after</text></svg>`)}`,
  balancedDensitometer,
  1,
);
const clippedPreviewProof = buildNegativeLabBaseSamplePreviewProof(
  buildPreviewContext(clippedEstimate, clippedCase.fixtureId, 'custom_rect'),
  `data:image/svg+xml,${encodeURIComponent(`<svg><text>${clippedCase.fixtureId}:after</text></svg>`)}`,
  clippedDensitometer,
  2,
);
const balancedWarnings = buildNegativeLabBaseSampleWarningCodes(balancedEstimate, balancedDensitometer);
const clippedWarnings = buildNegativeLabBaseSampleWarningCodes(clippedEstimate, clippedDensitometer);
const balancedConfidence = classifyNegativeLabBaseSampleConfidence(balancedEstimate);
const clippedConfidence = classifyNegativeLabBaseSampleConfidence(clippedEstimate);

negativeLabUpdateBaseSamplesCommandV1Schema.parse(balancedPreviewProof.command);
negativeLabUpdateBaseSamplesCommandV1Schema.parse(clippedPreviewProof.command);

const failures = [];

if (
  !approxEqual(
    balancedDensitometer.densityRange,
    Math.max(...balancedEstimate.baseDensity) - Math.min(...balancedEstimate.baseDensity),
  )
) {
  failures.push('balanced base/fog density range did not match the runtime readout.');
}
if (balancedDensitometer.status !== 'strong_cast' || balancedDensitometer.dominantChannel !== 'blue') {
  failures.push('gray-ramp base/fog should resolve to a blue-dominant strong cast.');
}
if (
  balancedRouteResult.status !== balancedDensitometer.status ||
  balancedRouteResult.densityRange !== balancedDensitometer.densityRange
) {
  failures.push('densitometer route result diverged from the base/fog utility output.');
}
if (balancedConfidence !== 'high') {
  failures.push(`expected high confidence for gray-ramp base/fog, got ${balancedConfidence}.`);
}
if (balancedWarnings.join(',') !== 'uneven_illumination') {
  failures.push(
    `expected gray-ramp base/fog warning to be uneven_illumination, got ${balancedWarnings.join(',') || 'none'}.`,
  );
}
if (!balancedPreviewProof.previewChanged || balancedPreviewProof.sampleSource !== 'preset_rect') {
  failures.push('balanced preview proof did not preserve preview-change or sample-source state.');
}
if (balancedPreviewProof.warningCodes.join(',') !== balancedWarnings.join(',')) {
  failures.push('balanced preview proof warning codes did not match the computed warning list.');
}
if (balancedPreviewProof.command.parameters.sampleRecords[0]?.confidence !== balancedConfidence) {
  failures.push('balanced preview proof command confidence did not match the classifier output.');
}

if (clippedDensitometer.status !== 'strong_cast' || clippedDensitometer.dominantChannel !== 'blue') {
  failures.push('clipped base/fog should resolve to a blue-dominant strong cast.');
}
if (
  clippedRouteResult.status !== clippedDensitometer.status ||
  clippedRouteResult.densityRange !== clippedDensitometer.densityRange
) {
  failures.push('clipped densitometer route result diverged from the base/fog utility output.');
}
if (clippedConfidence !== 'low') {
  failures.push(`expected low confidence for clipped base/fog, got ${clippedConfidence}.`);
}
if (
  clippedWarnings.join(',') !== ['low_acquisition_confidence', 'clipped_base_channel', 'uneven_illumination'].join(',')
) {
  failures.push(
    `expected clipped base/fog warnings to include low confidence, clipping, and uneven illumination, got ${clippedWarnings.join(',') || 'none'}.`,
  );
}
if (!clippedPreviewProof.previewChanged || clippedPreviewProof.sampleSource !== 'custom_rect') {
  failures.push('clipped preview proof did not preserve preview-change or sample-source state.');
}
if (clippedPreviewProof.warningCodes.join(',') !== clippedWarnings.join(',')) {
  failures.push('clipped preview proof warning codes did not match the computed warning list.');
}
if (clippedPreviewProof.command.parameters.sampleRegions[0]?.geometry.x !== normalizedSampleRect.x) {
  failures.push('clipped preview proof command did not carry the requested sample rect.');
}
if (clippedPreviewProof.command.parameters.sampleRecords[0]?.confidence !== clippedConfidence) {
  failures.push('clipped preview proof command confidence did not match the classifier output.');
}

if (failures.length > 0) {
  console.error(`negative lab base/fog failed (${failures.length})`);
  console.error(failures.slice(0, 20).join('\n'));
  process.exit(1);
}

console.log(
  `negative lab base/fog ok (${grayCase.fixtureId}, ${clippedCase.fixtureId}, ${balancedDensitometer.status}/${clippedDensitometer.status})`,
);
