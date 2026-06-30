#!/usr/bin/env bun
// @ts-check

import { readFile } from 'node:fs/promises';

import { z } from 'zod';
import type { NegativeLabRgbTriplet } from '../../../src/utils/negativeLabDensityConversion.ts';
import {
  convertNegativeLabDensitySamples,
  NEGATIVE_LAB_DENSITY_ALGORITHM_ID,
} from '../../../src/utils/negativeLabDensityConversion.ts';
import {
  buildNegativeLabRuntimeProfileProvenanceHash,
  resolveNegativeLabRuntimeProfile,
} from '../../../src/utils/negativeLabMeasuredProfileRuntime.ts';

const rgbTripletSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);
const syntheticProofSchema = z
  .object({
    cases: z
      .array(
        z
          .object({
            baseFogRgb: rgbTripletSchema.nullable(),
            fixtureId: z.string().min(1),
            knownPositiveRgb: z.array(rgbTripletSchema).min(1),
            negativeRgb: z.array(rgbTripletSchema).min(1),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const renderProofSchema = z
  .object({
    changedPixelCount: z.number().int().positive(),
    densityAlgorithm: z.literal(NEGATIVE_LAB_DENSITY_ALGORITHM_ID),
    fixtureId: z.literal('negative_lab.synthetic.color_ramp_exposure_offsets_001'),
    genericMeanAbsErrorToKnownPositive: z.number().min(0).max(1),
    measuredMeanAbsDeltaFromGeneric: z.number().min(0).max(1),
    measuredMeanAbsErrorToKnownPositive: z.number().min(0).max(1),
    measuredMeanAbsInputDelta: z.number().min(0).max(1),
    profileId: z.literal('negative_lab.measured.c41.process_family.v1'),
    profileProvenanceHash: z.string().regex(/^fnv1a32:[a-f0-9]+$/u),
  })
  .strict()
  .superRefine((proof, context) => {
    if (proof.measuredMeanAbsInputDelta < 0.1) {
      context.addIssue({
        code: 'custom',
        message: 'Measured Negative Lab render proof must materially modify negative input pixels.',
        path: ['measuredMeanAbsInputDelta'],
      });
    }

    if (proof.measuredMeanAbsDeltaFromGeneric < 0.005) {
      context.addIssue({
        code: 'custom',
        message: 'Measured Negative Lab render proof must differ from the generic source preset path.',
        path: ['measuredMeanAbsDeltaFromGeneric'],
      });
    }
  });

const fixturePath = new URL(
  '../../../fixtures/negative-lab/negative-lab-synthetic-fixture-proof.json',
  import.meta.url,
);
const proof = syntheticProofSchema.parse(JSON.parse(await readFile(fixturePath, 'utf8')));
const fixture = proof.cases.find(
  (entry) => entry.fixtureId === 'negative_lab.synthetic.color_ramp_exposure_offsets_001',
);
if (fixture === undefined || fixture.baseFogRgb === null) {
  throw new Error('Missing measured Negative Lab render fixture with base/fog RGB.');
}

const measuredProfile = resolveNegativeLabRuntimeProfile('negative_lab.measured.c41.process_family.v1');
const genericProfile = resolveNegativeLabRuntimeProfile(measuredProfile.sourceGenericPresetId ?? '');

const negativeRgb = fixture.negativeRgb;
const knownPositiveRgb = fixture.knownPositiveRgb;
const baseFogRgb = fixture.baseFogRgb;

const measuredPixels = convertNegativeLabDensitySamples(negativeRgb, baseFogRgb, measuredProfile.params);
const genericPixels = convertNegativeLabDensitySamples(negativeRgb, baseFogRgb, genericProfile.params);

const meanAbsDelta = (left: readonly NegativeLabRgbTriplet[], right: readonly NegativeLabRgbTriplet[]): number => {
  let sum = 0;
  let count = 0;

  for (const [pixelIndex, leftPixel] of left.entries()) {
    const rightPixel = right[pixelIndex];
    if (rightPixel === undefined) throw new Error(`Missing comparison pixel ${pixelIndex}.`);

    for (const [channelIndex, leftChannel] of leftPixel.entries()) {
      const rightChannel = rightPixel[channelIndex];
      if (rightChannel === undefined) throw new Error(`Missing comparison channel ${channelIndex}.`);
      sum += Math.abs(leftChannel - rightChannel);
      count += 1;
    }
  }

  return sum / count;
};

const changedPixelCount = measuredPixels.filter((pixel, pixelIndex) =>
  pixel.some((channel, channelIndex) => Math.abs(channel - negativeRgb[pixelIndex][channelIndex]) > 0.01),
).length;

const renderProof = renderProofSchema.parse({
  changedPixelCount,
  densityAlgorithm: NEGATIVE_LAB_DENSITY_ALGORITHM_ID,
  fixtureId: fixture.fixtureId,
  genericMeanAbsErrorToKnownPositive: meanAbsDelta(genericPixels, knownPositiveRgb),
  measuredMeanAbsDeltaFromGeneric: meanAbsDelta(measuredPixels, genericPixels),
  measuredMeanAbsErrorToKnownPositive: meanAbsDelta(measuredPixels, knownPositiveRgb),
  measuredMeanAbsInputDelta: meanAbsDelta(measuredPixels, negativeRgb),
  profileId: measuredProfile.presetId,
  profileProvenanceHash: buildNegativeLabRuntimeProfileProvenanceHash(measuredProfile),
});

console.log(
  `negative lab measured render proof ok (${renderProof.changedPixelCount} pixels, delta ${renderProof.measuredMeanAbsInputDelta.toFixed(3)})`,
);
