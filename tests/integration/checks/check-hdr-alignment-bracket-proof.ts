#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { z } from 'zod';
import { estimateHdrAlignmentTransformsV1 } from '../../../packages/rawengine-schema/src/hdrAlignmentRuntime.ts';
import { detectHdrBracketV1 } from '../../../packages/rawengine-schema/src/hdrBracketDetection.ts';
import { hdrAlignmentSummaryV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const MANIFEST_PATH = 'fixtures/hdr/hdr-synthetic-bracket-fixtures.json';
const REPORT_PATH = 'docs/validation/hdr-alignment-bracket-proof-2026-06-18.json';
const GENERATED_AT = '2026-06-18T00:00:00.000Z';
const SEARCH_RADIUS_PX = 5;
const MIN_ALIGNMENT_CONFIDENCE = 0.99;
const MAX_TRANSLATION_ERROR_PX = 0;

const sourceFrameSchema = z
  .object({
    expectedTranslationX: z.number().int(),
    expectedTranslationY: z.number().int(),
    exposureEv: z.number(),
    height: z.number().int().positive(),
    sourceIndex: z.number().int().nonnegative(),
    width: z.number().int().positive(),
  })
  .strict();

const fixtureSchema = z
  .object({
    expectedWarningCodes: z.array(z.string().trim().min(1)),
    fixtureId: z.string().trim().min(1),
    sourceFrames: z.array(sourceFrameSchema).min(2),
    validationPurpose: z.string().trim().min(1),
  })
  .strict()
  .passthrough();

const manifestSchema = z
  .object({
    fixtures: z.array(fixtureSchema).min(1),
    schemaVersion: z.number().int().positive(),
  })
  .strict()
  .passthrough();

const pointSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
  })
  .strict();

const transformProofSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    expectedTranslationPx: pointSchema,
    sourceIndex: z.number().int().nonnegative(),
    transformType: z.enum(['identity', 'translation']),
    translationErrorPx: z.number().nonnegative(),
    translationPx: pointSchema,
  })
  .strict();

const reportSchema = z
  .object({
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(1927),
    proofHash: z.string().trim().min(1),
    rejectedScenarios: z.array(
      z
        .object({
          accepted: z.literal(false),
          blockCodes: z.array(z.string().trim().min(1)).min(1),
          fixtureId: z.string().trim().min(1),
          nextAction: z.string().trim().min(1),
        })
        .strict(),
    ),
    schemaVersion: z.literal(1),
    scenarios: z.array(
      z
        .object({
          alignmentConfidence: z.number().min(0).max(1),
          bracketAccepted: z.literal(true),
          bracketSpanEv: z.number().positive(),
          fixtureId: z.string().trim().min(1),
          maxTranslationErrorPx: z.number().nonnegative(),
          referenceSourceIndex: z.number().int().nonnegative(),
          runtimeStatus: z.literal('synthetic_fixture_gate'),
          transforms: z.array(transformProofSchema).min(2),
          validationPurpose: z.string().trim().min(1),
          warningCodes: z.array(z.string().trim().min(1)),
        })
        .strict(),
    ),
  })
  .strict();

type SourceFrame = z.infer<typeof sourceFrameSchema>;
type Fixture = z.infer<typeof fixtureSchema>;
type Report = z.infer<typeof reportSchema>;

const update = process.argv.includes('--update');
const manifest = manifestSchema.parse(await Bun.file(MANIFEST_PATH).json());
const scenarios = manifest.fixtures.map(buildScenarioProof);
const rejectedScenarios = [buildDuplicateExposureRejection(manifest.fixtures[0])];
const proofPayload = { rejectedScenarios, scenarios };
const report = reportSchema.parse({
  generatedAt: GENERATED_AT,
  issue: 1927,
  proofHash: new Bun.CryptoHasher('sha256').update(JSON.stringify(proofPayload)).digest('hex'),
  rejectedScenarios,
  schemaVersion: 1,
  scenarios,
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log(`hdr alignment bracket proof updated (${report.scenarios.length} scenarios)`);
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:hdr-alignment-bracket-proof:update.`);
}

const existingReport = reportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:hdr-alignment-bracket-proof:update.`);
}

console.log(`hdr alignment bracket proof ok (${report.scenarios.length} scenarios)`);

function buildScenarioProof(fixture: Fixture): Report['scenarios'][number] {
  const referenceSourceIndex = getReferenceSourceIndex(fixture.sourceFrames);
  const bracketDetection = detectHdrBracketV1({
    sources: fixture.sourceFrames.map((frame) => ({
      cameraMake: 'Synthetic',
      cameraModel: 'RawEngine HDR fixture',
      captureTimestamp: `2026-06-18T12:00:0${frame.sourceIndex}.000Z`,
      declaredExposureEv: frame.exposureEv,
      height: frame.height,
      imagePath: `/synthetic/hdr/${fixture.fixtureId}-${frame.sourceIndex}.dng`,
      lensModel: 'Synthetic 35mm',
      rawBlackLevelKnown: true,
      rawWhiteLevelKnown: true,
      sourceIndex: frame.sourceIndex,
      whiteBalanceComparable: true,
      width: frame.width,
    })),
  });
  if (!bracketDetection.accepted) {
    throw new Error(`${fixture.fixtureId} should be accepted as an HDR bracket.`);
  }

  const [firstFrame] = fixture.sourceFrames;
  if (firstFrame === undefined) throw new Error(`${fixture.fixtureId} has no frames.`);
  const referencePixels = createSyntheticReference(firstFrame.width, firstFrame.height);
  const alignment = estimateHdrAlignmentTransformsV1({
    frames: fixture.sourceFrames.map((frame) => ({
      height: frame.height,
      pixels: shiftImage(
        referencePixels,
        frame.width,
        frame.height,
        -frame.expectedTranslationX,
        -frame.expectedTranslationY,
      ),
      sourceIndex: frame.sourceIndex,
      width: frame.width,
    })),
    referenceSourceIndex,
    searchRadiusPx: SEARCH_RADIUS_PX,
  });

  const transforms = alignment.transforms.map((transform) => {
    const frame = getFrame(fixture.sourceFrames, transform.sourceIndex);
    const expectedTranslationPx = {
      x: frame.expectedTranslationX,
      y: frame.expectedTranslationY,
    };
    const translationErrorPx =
      Math.abs(transform.translationPx.x - expectedTranslationPx.x) +
      Math.abs(transform.translationPx.y - expectedTranslationPx.y);
    if (translationErrorPx > MAX_TRANSLATION_ERROR_PX) {
      throw new Error(`${fixture.fixtureId} source ${frame.sourceIndex} translation error ${translationErrorPx}px.`);
    }

    return transformProofSchema.parse({
      confidence: transform.confidence,
      expectedTranslationPx,
      sourceIndex: transform.sourceIndex,
      transformType: transform.transformType,
      translationErrorPx,
      translationPx: transform.translationPx,
    });
  });
  const maxTranslationErrorPx = Math.max(...transforms.map((transform) => transform.translationErrorPx));
  if (alignment.alignmentConfidence < MIN_ALIGNMENT_CONFIDENCE) {
    throw new Error(`${fixture.fixtureId} alignment confidence ${alignment.alignmentConfidence} is too low.`);
  }

  hdrAlignmentSummaryV1Schema.parse({
    alignmentConfidence: alignment.alignmentConfidence,
    referenceSourceIndex: alignment.referenceSourceIndex,
    rejectedSourceIndexes: [],
    requestedAlignmentMode: 'translation',
    resolvedAlignmentMode: 'translation',
    transforms: alignment.transforms.map((transform) => ({
      confidence: transform.confidence,
      sourceIndex: transform.sourceIndex,
      transformType: transform.transformType,
      translationPx: transform.translationPx,
    })),
  });

  return {
    alignmentConfidence: alignment.alignmentConfidence,
    bracketAccepted: bracketDetection.accepted,
    bracketSpanEv: bracketDetection.bracketSpanEv,
    fixtureId: fixture.fixtureId,
    maxTranslationErrorPx,
    referenceSourceIndex,
    runtimeStatus: 'synthetic_fixture_gate',
    transforms,
    validationPurpose: fixture.validationPurpose,
    warningCodes: [...new Set([...fixture.expectedWarningCodes, ...bracketDetection.warningCodes])].toSorted(),
  };
}

function buildDuplicateExposureRejection(fixture: Fixture | undefined): Report['rejectedScenarios'][number] {
  if (fixture === undefined) throw new Error('HDR rejection proof requires at least one fixture.');
  const detection = detectHdrBracketV1({
    sources: fixture.sourceFrames.map((frame) => ({
      declaredExposureEv: 0,
      height: frame.height,
      imagePath: `/synthetic/hdr/rejected-duplicate-${frame.sourceIndex}.dng`,
      rawBlackLevelKnown: true,
      rawWhiteLevelKnown: true,
      sourceIndex: frame.sourceIndex,
      whiteBalanceComparable: true,
      width: frame.width,
    })),
  });
  if (detection.accepted) throw new Error('Duplicate exposure HDR rejection proof was accepted unexpectedly.');
  if (!detection.blockCodes.includes('duplicate_exposure_values')) {
    throw new Error('Duplicate exposure HDR rejection proof did not emit duplicate_exposure_values.');
  }

  return {
    accepted: false,
    blockCodes: detection.blockCodes,
    fixtureId: 'hdr.synthetic.rejected-duplicate-exposure.v1',
    nextAction: 'Ask for distinct exposure EV metadata or disable required bracket validation intentionally.',
  };
}

function getReferenceSourceIndex(frames: SourceFrame[]): number {
  const reference = frames.find((frame) => frame.exposureEv === 0) ?? frames[Math.floor(frames.length / 2)];
  if (reference === undefined) throw new Error('HDR reference frame lookup failed.');
  return reference.sourceIndex;
}

function getFrame(frames: SourceFrame[], sourceIndex: number): SourceFrame {
  const frame = frames.find((candidate) => candidate.sourceIndex === sourceIndex);
  if (frame === undefined) throw new Error(`Missing HDR source frame ${sourceIndex}.`);
  return frame;
}

function createSyntheticReference(width: number, height: number): Float64Array {
  const pixels = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = x / width + y / height;
      const verticalLine = x % 17 === 0 ? 0.45 : 0;
      const horizontalLine = y % 19 === 0 ? 0.35 : 0;
      const target = isInsideRect(x, y, 36, 28, 23, 17) || isInsideRect(x, y, 127, 55, 41, 29) ? 0.8 : 0;
      pixels[y * width + x] = gradient + verticalLine + horizontalLine + target;
    }
  }
  return pixels;
}

function shiftImage(image: Float64Array, width: number, height: number, shiftX: number, shiftY: number): Float64Array {
  const shifted = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - shiftX;
      const sourceY = y - shiftY;
      if (sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height) {
        shifted[y * width + x] = image[sourceY * width + sourceX] ?? 0;
      }
    }
  }
  return shifted;
}

function isInsideRect(x: number, y: number, left: number, top: number, width: number, height: number): boolean {
  return x >= left && x < left + width && y >= top && y < top + height;
}
