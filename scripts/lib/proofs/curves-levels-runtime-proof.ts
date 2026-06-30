import { createHash } from 'node:crypto';

import { z } from 'zod';

import { toneColorCommandEnvelopeV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { applyLumaLevelsToRgbPixel, type RgbPixel } from '../../../src/utils/color/runtime/levelsRuntime.ts';

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const CHANNEL_KEYS = ['red', 'green', 'blue'] as const;
const CURVE_POINT_LIMIT = 16;

const rgbPixelSchema = z
  .object({
    blue: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    red: z.number().min(0).max(1),
  })
  .strict();

const invalidCommandFixtureSchema = z
  .object({
    case: z.string().trim().min(1),
    input: z.unknown(),
  })
  .strict();

const proofExpectedSchema = z
  .object({
    afterHash: hashSchema,
    beforeHash: hashSchema,
    changedPixels: z.number().int().positive(),
    curveChangedPixels: z.number().int().positive(),
    levelsChangedPixels: z.number().int().positive(),
    levelsHash: hashSchema,
    outputPixels: z.array(rgbPixelSchema).min(1),
  })
  .strict();

export const curvesLevelsRuntimeProofFixtureSchema = z
  .object({
    curveCommand: z.unknown(),
    expected: proofExpectedSchema,
    invalidCommands: z.array(invalidCommandFixtureSchema).min(1),
    levelsCommand: z.unknown(),
    proofId: z.literal('color.runtime.curves-levels.synthetic.v1'),
    runtimeStatus: z.literal('synthetic_runtime_apply_capable'),
    schemaVersion: z.literal(1),
    sourcePixels: z.array(rgbPixelSchema).min(1),
  })
  .strict();

export const curvesLevelsRuntimeProofArtifactSchema = z
  .object({
    afterHash: hashSchema,
    beforeHash: hashSchema,
    changedPixels: z.number().int().positive(),
    curveChangedPixels: z.number().int().positive(),
    curveCommandId: z.string().trim().min(1),
    curveInterpolation: z.literal('monotone_cubic'),
    curvePointLimit: z.literal(CURVE_POINT_LIMIT),
    graphRevision: z.string().trim().min(1),
    levelsChangedPixels: z.number().int().positive(),
    levelsCommandId: z.string().trim().min(1),
    levelsHash: hashSchema,
    outputPixels: z.array(rgbPixelSchema).min(1),
    proofId: z.literal('color.runtime.curves-levels.synthetic.v1'),
    renderer: z.literal('synthetic_levels_then_monotone_curve_v1'),
    runtimeStatus: z.literal('synthetic_runtime_apply_capable'),
    schemaVersion: z.literal(1),
    stageOrder: z.tuple([z.literal('luma_levels'), z.literal('monotone_cubic_curve')]),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.beforeHash === artifact.levelsHash) {
      context.addIssue({ code: 'custom', message: 'Levels stage must change the source hash.' });
    }

    if (artifact.levelsHash === artifact.afterHash) {
      context.addIssue({ code: 'custom', message: 'Curve stage must change the levels hash.' });
    }

    if (artifact.beforeHash === artifact.afterHash) {
      context.addIssue({ code: 'custom', message: 'Final render output must change the source hash.' });
    }
  });

export type CurvesLevelsRuntimeProofArtifact = z.infer<typeof curvesLevelsRuntimeProofArtifactSchema>;
export type CurvesLevelsRuntimeProofFixture = z.infer<typeof curvesLevelsRuntimeProofFixtureSchema>;
type ToneColorCommand = z.infer<typeof toneColorCommandEnvelopeV1Schema>;
type ToneCurveCommand = Extract<ToneColorCommand, { commandType: 'toneColor.setToneCurve' }>;
type LevelsCommand = Extract<ToneColorCommand, { commandType: 'toneColor.setLevels' }>;
type CurvePoint = ToneCurveCommand['parameters']['points'][number];

export function renderCurvesLevelsRuntimeProof(
  fixture: CurvesLevelsRuntimeProofFixture,
): CurvesLevelsRuntimeProofArtifact {
  const curveCommand = parseToneCurveCommand(fixture.curveCommand);
  const levelsCommand = parseLevelsCommand(fixture.levelsCommand);

  if (curveCommand.parameters.interpolation !== 'monotone_cubic') {
    throw new Error('Curves + levels proof requires monotone_cubic interpolation.');
  }

  if (curveCommand.parameters.points.length > CURVE_POINT_LIMIT) {
    throw new Error(`Curves + levels proof supports at most ${CURVE_POINT_LIMIT} curve points.`);
  }

  const { channel: _channel, ...levelsSettings } = levelsCommand.parameters;
  const levelsPixels = fixture.sourcePixels.map((pixel) =>
    roundRgbPixel(applyLumaLevelsToRgbPixel(pixel, levelsSettings)),
  );
  const outputPixels = levelsPixels.map((pixel) => applyLumaCurveToRgbPixel(pixel, curveCommand.parameters.points));

  return curvesLevelsRuntimeProofArtifactSchema.parse({
    afterHash: hashRgbPixels(outputPixels),
    beforeHash: hashRgbPixels(fixture.sourcePixels),
    changedPixels: countChangedPixels(fixture.sourcePixels, outputPixels),
    curveChangedPixels: countChangedPixels(levelsPixels, outputPixels),
    curveCommandId: curveCommand.commandId,
    curveInterpolation: curveCommand.parameters.interpolation,
    curvePointLimit: CURVE_POINT_LIMIT,
    graphRevision: curveCommand.expectedGraphRevision,
    levelsChangedPixels: countChangedPixels(fixture.sourcePixels, levelsPixels),
    levelsCommandId: levelsCommand.commandId,
    levelsHash: hashRgbPixels(levelsPixels),
    outputPixels,
    proofId: fixture.proofId,
    renderer: 'synthetic_levels_then_monotone_curve_v1',
    runtimeStatus: fixture.runtimeStatus,
    schemaVersion: fixture.schemaVersion,
    stageOrder: ['luma_levels', 'monotone_cubic_curve'],
  });
}

export function collectCurvesLevelsRuntimeProofFailures(
  fixture: CurvesLevelsRuntimeProofFixture,
  artifact: CurvesLevelsRuntimeProofArtifact,
): Array<string> {
  const failures: Array<string> = [];

  for (const key of [
    'afterHash',
    'beforeHash',
    'changedPixels',
    'curveChangedPixels',
    'levelsChangedPixels',
    'levelsHash',
  ] as const) {
    if (artifact[key] !== fixture.expected[key]) {
      failures.push(`${key}: expected ${fixture.expected[key]}, got ${artifact[key]}`);
    }
  }

  const expectedJson = JSON.stringify(fixture.expected.outputPixels);
  const actualJson = JSON.stringify(artifact.outputPixels);
  if (actualJson !== expectedJson) {
    failures.push(`outputPixels: expected ${expectedJson}, got ${actualJson}`);
  }

  for (const invalidCommand of fixture.invalidCommands) {
    try {
      toneColorCommandEnvelopeV1Schema.parse(invalidCommand.input);
      failures.push(`${invalidCommand.case}: expected invalid command to fail.`);
    } catch (_error) {
      // Expected invalid fixture.
    }
  }

  return failures;
}

function parseToneCurveCommand(value: unknown): ToneCurveCommand {
  const command = toneColorCommandEnvelopeV1Schema.parse(value);
  if (command.commandType !== 'toneColor.setToneCurve') {
    throw new Error('Expected toneColor.setToneCurve command.');
  }
  return command;
}

function parseLevelsCommand(value: unknown): LevelsCommand {
  const command = toneColorCommandEnvelopeV1Schema.parse(value);
  if (command.commandType !== 'toneColor.setLevels') {
    throw new Error('Expected toneColor.setLevels command.');
  }
  return command;
}

function applyLumaCurveToRgbPixel(pixel: RgbPixel, points: ReadonlyArray<CurvePoint>): RgbPixel {
  return {
    blue: applyMonotoneCubicCurve(pixel.blue, points),
    green: applyMonotoneCubicCurve(pixel.green, points),
    red: applyMonotoneCubicCurve(pixel.red, points),
  };
}

function applyMonotoneCubicCurve(value: number, normalizedPoints: ReadonlyArray<CurvePoint>): number {
  if (normalizedPoints.length < 2) return value;

  const points = normalizedPoints.map((point) => ({ x: point.input * 255, y: point.output * 255 }));
  const x = value * 255;
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  if (firstPoint === undefined || lastPoint === undefined) return value;
  if (x <= firstPoint.x) return roundChannel(firstPoint.y / 255);
  if (x >= lastPoint.x) return roundChannel(lastPoint.y / 255);

  for (let index = 0; index < points.length - 1; index += 1) {
    const p1 = points[index];
    const p2 = points[index + 1];
    if (p1 === undefined || p2 === undefined) continue;
    if (x > p2.x) continue;

    const p0 = points[Math.max(0, index - 1)] ?? p1;
    const p3 = points[Math.min(points.length - 1, index + 2)] ?? p2;
    const deltaBefore = (p1.y - p0.y) / Math.max(0.001, p1.x - p0.x);
    const deltaCurrent = (p2.y - p1.y) / Math.max(0.001, p2.x - p1.x);
    const deltaAfter = (p3.y - p2.y) / Math.max(0.001, p3.x - p2.x);
    let tangentAtP1 = index === 0 ? deltaCurrent : averageMonotoneTangent(deltaBefore, deltaCurrent);
    let tangentAtP2 = index + 1 === points.length - 1 ? deltaCurrent : averageMonotoneTangent(deltaCurrent, deltaAfter);

    if (deltaCurrent !== 0) {
      const alpha = tangentAtP1 / deltaCurrent;
      const beta = tangentAtP2 / deltaCurrent;
      const magnitude = alpha * alpha + beta * beta;
      if (magnitude > 9) {
        const tau = 3 / Math.sqrt(magnitude);
        tangentAtP1 *= tau;
        tangentAtP2 *= tau;
      }
    }

    return roundChannel(clamp01(interpolateCubicHermite(x, p1.x, p1.y, p2.x, p2.y, tangentAtP1, tangentAtP2) / 255));
  }

  return roundChannel(lastPoint.y / 255);
}

function averageMonotoneTangent(previousDelta: number, nextDelta: number): number {
  return previousDelta * nextDelta <= 0 ? 0 : (previousDelta + nextDelta) / 2;
}

function interpolateCubicHermite(
  x: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tangentAtP1: number,
  tangentAtP2: number,
): number {
  const dx = x2 - x1;
  if (dx <= 0) return y1;

  const t = (x - x1) / dx;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * y1 + h10 * tangentAtP1 * dx + h01 * y2 + h11 * tangentAtP2 * dx;
}

function countChangedPixels(before: ReadonlyArray<RgbPixel>, after: ReadonlyArray<RgbPixel>): number {
  return after.filter((pixel, index) => {
    const beforePixel = before[index];
    if (beforePixel === undefined) return true;

    return CHANNEL_KEYS.some((channel) => pixel[channel] !== beforePixel[channel]);
  }).length;
}

function hashRgbPixels(pixels: ReadonlyArray<RgbPixel>): string {
  const stablePixels = pixels.map((pixel) => [pixel.red, pixel.green, pixel.blue]);
  return `sha256:${createHash('sha256').update(JSON.stringify(stablePixels)).digest('hex')}`;
}

function roundRgbPixel(pixel: RgbPixel): RgbPixel {
  return {
    blue: roundChannel(pixel.blue),
    green: roundChannel(pixel.green),
    red: roundChannel(pixel.red),
  };
}

function roundChannel(value: number): number {
  return Number(value.toFixed(6));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
