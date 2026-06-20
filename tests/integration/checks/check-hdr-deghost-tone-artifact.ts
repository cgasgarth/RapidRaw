#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { z } from 'zod';

import {
  countHdrMotionPixelsV1,
  detectHdrMotionMaskV1,
  measureHdrMotionMaskV1,
  measureHdrMotionRegionMaeV1,
  mergeHdrWithReferenceInMotionRegionsV1,
} from '../../../packages/rawengine-schema/src/hdrDeghostRuntime.ts';
import {
  measureHdrMergeWeightingV1,
  mergeExposureWeightedRadianceV1,
} from '../../../packages/rawengine-schema/src/hdrMergeWeightingRuntime.ts';

const REPORT_PATH = 'docs/validation/hdr-deghost-tone-artifact-proof-2026-06-18.json';
const GENERATED_AT = '2026-06-18T00:00:00.000Z';
const DEGhost_WIDTH = 72;
const DEGhost_HEIGHT = 48;
const TONE_WIDTH = 64;
const TONE_HEIGHT = 48;
const MOTION_THRESHOLD = 0.22;
const CLIP_THRESHOLD = 0.99;
const SENSOR_WHITE_RADIANCE = 1;
const MIN_RECALL = 0.95;
const MIN_PRECISION = 0.9;
const MAX_GHOST_MAE = 0.01;
const MIN_RECOVERED_HIGHLIGHT_RATIO = 0.9;
const MAX_UNRECOVERED_CLIPPED_RATIO = 0.03;
const MAX_RECONSTRUCTION_MAE = 0.015;
const BRACKETS = [
  { exposureEv: -2, sourceIndex: 0 },
  { exposureEv: 0, sourceIndex: 1 },
  { exposureEv: 2, sourceIndex: 2 },
];

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const metricsSchema = z
  .object({
    falseNegative: z.number().int().nonnegative(),
    falsePositive: z.number().int().nonnegative(),
    precision: z.number().min(0).max(1),
    recall: z.number().min(0).max(1),
    truePositive: z.number().int().nonnegative(),
  })
  .strict();

const reportSchema = z
  .object({
    deghost: z
      .object({
        ghostMeanAbsoluteError: z.number().min(0).max(MAX_GHOST_MAE),
        maskHash: hashSchema,
        metrics: metricsSchema,
        motionCoverageRatio: z.number().min(0).max(1),
        outputHash: hashSchema,
        referenceSourceIndex: z.number().int().nonnegative(),
      })
      .strict(),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(1928),
    proofHash: hashSchema,
    schemaVersion: z.literal(1),
    tone: z
      .object({
        brackets: z.array(
          z
            .object({
              exposureEv: z.number(),
              sourceIndex: z.number().int().nonnegative(),
            })
            .strict(),
        ),
        metrics: z
          .object({
            meanAbsoluteError: z.number().min(0).max(MAX_RECONSTRUCTION_MAE),
            recoveredHighlightPixelRatio: z.number().min(MIN_RECOVERED_HIGHLIGHT_RATIO).max(1),
            shadowNoiseAmplificationRisk: z.literal('low'),
            unrecoveredClippedPixelRatio: z.number().min(0).max(MAX_UNRECOVERED_CLIPPED_RATIO),
          })
          .strict()
          .passthrough(),
        previewHash: hashSchema,
        sceneLinearOutputHash: hashSchema,
        toneMap: z.literal('reinhard_gamma_2_2_preview'),
      })
      .strict(),
    validationStatus: z.literal('synthetic_artifact_gate'),
  })
  .strict();

const update = process.argv.includes('--update');
const deghost = buildDeghostArtifactProof();
const tone = buildToneArtifactProof();
const proofPayload = { deghost, tone, validationStatus: 'synthetic_artifact_gate' };
const report = reportSchema.parse({
  deghost,
  generatedAt: GENERATED_AT,
  issue: 1928,
  proofHash: hashString(JSON.stringify(proofPayload)),
  schemaVersion: 1,
  tone,
  validationStatus: 'synthetic_artifact_gate',
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('hdr deghost tone artifact proof updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:hdr-deghost-tone-artifact:update.`);
}

const existingReport = reportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:hdr-deghost-tone-artifact:update.`);
}

console.log('hdr deghost tone artifact proof ok');

function buildDeghostArtifactProof(): z.infer<typeof reportSchema>['deghost'] {
  const background = createDeghostBackground(DEGhost_WIDTH, DEGhost_HEIGHT);
  const objectMasks = [
    createRectangleMask(DEGhost_WIDTH, DEGhost_HEIGHT, 8, 20, 10, 10),
    createRectangleMask(DEGhost_WIDTH, DEGhost_HEIGHT, 31, 20, 10, 10),
    createRectangleMask(DEGhost_WIDTH, DEGhost_HEIGHT, 54, 20, 10, 10),
  ];
  const expectedMotionMask = unionMasks(objectMasks);
  const frames = objectMasks.map((mask, sourceIndex) => ({
    height: DEGhost_HEIGHT,
    pixels: compositeMovingObject(background, mask),
    sourceIndex,
    width: DEGhost_WIDTH,
  }));
  const referenceFrame = frames[1];
  if (referenceFrame === undefined) throw new Error('HDR deghost artifact proof requires a reference frame.');

  const request = {
    frames,
    motionThreshold: MOTION_THRESHOLD,
    referenceSourceIndex: referenceFrame.sourceIndex,
  };
  const detectedMotionMask = detectHdrMotionMaskV1(request);
  const metrics = measureHdrMotionMaskV1(expectedMotionMask, detectedMotionMask);
  const deghosted = mergeHdrWithReferenceInMotionRegionsV1(request, detectedMotionMask);
  const ghostMeanAbsoluteError = measureHdrMotionRegionMaeV1(referenceFrame.pixels, deghosted, expectedMotionMask);

  if (metrics.recall < MIN_RECALL) throw new Error(`HDR deghost recall ${metrics.recall} below ${MIN_RECALL}.`);
  if (metrics.precision < MIN_PRECISION) {
    throw new Error(`HDR deghost precision ${metrics.precision} below ${MIN_PRECISION}.`);
  }
  if (ghostMeanAbsoluteError > MAX_GHOST_MAE) {
    throw new Error(`HDR deghost motion MAE ${ghostMeanAbsoluteError} above ${MAX_GHOST_MAE}.`);
  }

  return {
    ghostMeanAbsoluteError,
    maskHash: hashBytes(detectedMotionMask),
    metrics,
    motionCoverageRatio: roundMetric(countHdrMotionPixelsV1(detectedMotionMask) / detectedMotionMask.length),
    outputHash: hashFloat64(deghosted),
    referenceSourceIndex: referenceFrame.sourceIndex,
  };
}

function buildToneArtifactProof(): z.infer<typeof reportSchema>['tone'] {
  const scene = createToneScene(TONE_WIDTH, TONE_HEIGHT);
  const captures = BRACKETS.map((bracket) => ({
    ...bracket,
    pixels: renderBracket(scene, bracket.exposureEv),
  }));
  const merged = mergeExposureWeightedRadianceV1({
    captures,
    clipThreshold: CLIP_THRESHOLD,
    height: TONE_HEIGHT,
    sensorWhiteRadiance: SENSOR_WHITE_RADIANCE,
    width: TONE_WIDTH,
  });
  const metrics = measureHdrMergeWeightingV1({
    captures,
    clipThreshold: CLIP_THRESHOLD,
    maxReconstructionMae: MAX_RECONSTRUCTION_MAE,
    merged,
    scene,
  });

  if (metrics.recoveredHighlightPixelRatio < MIN_RECOVERED_HIGHLIGHT_RATIO) {
    throw new Error(`HDR recovered highlight ratio ${metrics.recoveredHighlightPixelRatio} too low.`);
  }
  if (metrics.unrecoveredClippedPixelRatio > MAX_UNRECOVERED_CLIPPED_RATIO) {
    throw new Error(`HDR unrecovered clipped ratio ${metrics.unrecoveredClippedPixelRatio} too high.`);
  }
  if (metrics.meanAbsoluteError > MAX_RECONSTRUCTION_MAE) {
    throw new Error(`HDR reconstruction MAE ${metrics.meanAbsoluteError} too high.`);
  }

  return {
    brackets: BRACKETS,
    metrics,
    previewHash: hashBytes(toneMapPreviewBytes(merged)),
    sceneLinearOutputHash: hashFloat64(merged),
    toneMap: 'reinhard_gamma_2_2_preview',
  };
}

function createDeghostBackground(width: number, height: number): Float64Array {
  const image = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = 0.12 + x / width + y / (height * 2);
      const window = x > 45 && y < 16 ? 1.2 : 0;
      image[y * width + x] = gradient + window;
    }
  }
  return image;
}

function createToneScene(width: number, height: number): Float64Array {
  const pixels = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = 0.08 + (x / (width - 1)) * 1.7;
      const windowHighlight = isInsideCircle(x, y, 48, 15, 8) ? 2.35 : 0;
      const lampHighlight = isInsideCircle(x, y, 18, 32, 6) ? 1.4 : 0;
      const shadowDetail = isInsideRect(x, y, 4, 6, 16, 16) ? 0.06 : 0;
      pixels[y * width + x] = gradient + windowHighlight + lampHighlight + shadowDetail;
    }
  }
  return pixels;
}

function renderBracket(scene: Float64Array, exposureEv: number): Float64Array {
  const exposureScale = 2 ** exposureEv;
  const pixels = new Float64Array(scene.length);
  for (let index = 0; index < scene.length; index += 1) {
    pixels[index] = Math.min(1, ((scene[index] ?? 0) * exposureScale) / SENSOR_WHITE_RADIANCE);
  }
  return pixels;
}

function createRectangleMask(
  width: number,
  height: number,
  left: number,
  top: number,
  rectWidth: number,
  rectHeight: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = top; y < top + rectHeight; y += 1) {
    for (let x = left; x < left + rectWidth; x += 1) {
      mask[y * width + x] = 1;
    }
  }
  return mask;
}

function unionMasks(masks: Uint8Array[]): Uint8Array {
  const [firstMask] = masks;
  if (firstMask === undefined) throw new Error('HDR deghost artifact proof requires masks.');

  const union = new Uint8Array(firstMask.length);
  for (const mask of masks) {
    for (let index = 0; index < mask.length; index += 1) {
      union[index] = union[index] === 1 || mask[index] === 1 ? 1 : 0;
    }
  }
  return union;
}

function compositeMovingObject(background: Float64Array, mask: Uint8Array): Float64Array {
  const image = new Float64Array(background);
  for (let index = 0; index < image.length; index += 1) {
    if (mask[index] === 1) image[index] = 2.1;
  }
  return image;
}

function toneMapPreviewBytes(pixels: Float64Array): Uint8Array {
  const bytes = new Uint8Array(pixels.length);
  for (let index = 0; index < pixels.length; index += 1) {
    const reinhard = (pixels[index] ?? 0) / (1 + (pixels[index] ?? 0));
    bytes[index] = Math.round(Math.max(0, Math.min(1, reinhard ** (1 / 2.2))) * 255);
  }
  return bytes;
}

function hashFloat64(pixels: Float64Array): string {
  return hashBytes(new Uint8Array(pixels.buffer));
}

function hashBytes(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

function hashString(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}

function isInsideCircle(x: number, y: number, centerX: number, centerY: number, radius: number): boolean {
  return (x - centerX) * (x - centerX) + (y - centerY) * (y - centerY) <= radius * radius;
}

function isInsideRect(x: number, y: number, left: number, top: number, width: number, height: number): boolean {
  return x >= left && x < left + width && y >= top && y < top + height;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
