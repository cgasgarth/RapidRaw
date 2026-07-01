import { z } from 'zod';

import {
  type LayerMaskCommandEnvelopeV1,
  type LayerMaskDryRunResultV1,
  type LayerMaskMutationResultV1,
  layerMaskCommandEnvelopeV1Schema,
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
} from './rawEngineSchemas.js';

const baseMaskArtifactSchema = z
  .object({
    alpha: z.array(z.number().min(0).max(1)).min(1),
    contentHash: z.string().trim().min(1).optional(),
    height: z.number().int().positive().max(16384),
    maskId: z.string().trim().min(1),
    width: z.number().int().positive().max(16384),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.alpha.length !== artifact.width * artifact.height) {
      context.addIssue({
        code: 'custom',
        message: 'Brush base mask artifact dimensions must match alpha length.',
        path: ['alpha'],
      });
    }
  });

export const brushMaskRenderRequestSchema = z
  .object({
    baseMask: baseMaskArtifactSchema.optional(),
    command: layerMaskCommandEnvelopeV1Schema,
    height: z.number().int().positive().max(16384),
    width: z.number().int().positive().max(16384),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.command.commandType !== 'layerMask.createBrushMask') {
      context.addIssue({
        code: 'custom',
        message: 'Brush mask runtime only accepts layerMask.createBrushMask commands.',
        path: ['command'],
      });
    }

    if (request.baseMask !== undefined) {
      if (request.baseMask.width !== request.width || request.baseMask.height !== request.height) {
        context.addIssue({
          code: 'custom',
          message: 'Brush base mask dimensions must match render dimensions.',
          path: ['baseMask'],
        });
      }
    }
  });

export type BrushMaskCommand = Extract<LayerMaskCommandEnvelopeV1, { commandType: 'layerMask.createBrushMask' }>;
export type BrushBaseMaskArtifact = z.infer<typeof baseMaskArtifactSchema>;
export type BrushMaskRenderRequest = z.infer<typeof brushMaskRenderRequestSchema>;

export interface BrushMaskRenderResult {
  alpha: Array<number>;
  contentHash: string;
  coverageSum: number;
  height: number;
  maskId: string;
  provenance: {
    baseMaskHash: string;
    contentHash: string;
    coverageSum: number;
    pressurePointCount: number;
    pressureUsed: boolean;
    strokeCount: number;
  };
  width: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const quantizeAlpha = (value: number): number => Math.round(clamp01(value) * 255);

const stableAlphaHash = (alpha: ReadonlyArray<number>): string => {
  let hash = 0x811c9dc5;
  for (const value of alpha) {
    hash ^= quantizeAlpha(value);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
};

const roundMetric = (value: number): number => Number(value.toFixed(6));

const toMaskIdSegment = (value: string): string => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/gu, '_');

const buildMaskId = (command: BrushMaskCommand): string => `mask_brush_${toMaskIdSegment(command.parameters.maskName)}`;

const normalizedBaseHash = (baseMask: BrushBaseMaskArtifact | undefined): string =>
  baseMask === undefined ? 'none' : (baseMask.contentHash ?? stableAlphaHash(baseMask.alpha));

const buildPlanKey = (command: BrushMaskCommand, request: BrushMaskRenderRequest): string =>
  JSON.stringify([
    command.expectedGraphRevision,
    command.target,
    command.parameters,
    request.width,
    request.height,
    normalizedBaseHash(request.baseMask),
  ]);

const pixelX = (x: number, width: number): number => (width === 1 ? 0 : x / (width - 1));
const pixelY = (y: number, height: number): number => (height === 1 ? 0 : y / (height - 1));
const pixelDistanceScale = (width: number, height: number): number => Math.max(width - 1, height - 1, 1);

const segmentDistance = (
  x: number,
  y: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
): { distance: number; t: number } => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) {
    return { distance: Math.hypot(x - start.x, y - start.y), t: 0 };
  }

  const t = clamp01(((x - start.x) * dx + (y - start.y) * dy) / lengthSquared);
  return { distance: Math.hypot(x - (start.x + dx * t), y - (start.y + dy * t)), t };
};

const pointPressure = (point: { pressure?: number | undefined }): number => point.pressure ?? 1;

const segmentPressure = (
  start: { pressure?: number | undefined },
  end: { pressure?: number | undefined },
  t: number,
): number => {
  const startPressure = pointPressure(start);
  const endPressure = pointPressure(end);
  return clamp01(startPressure + (endPressure - startPressure) * t);
};

const strokeCoverage = (
  x: number,
  y: number,
  stroke: BrushMaskCommand['parameters']['strokes'][number],
  width: number,
  height: number,
): number => {
  const radius = stroke.radiusPx / pixelDistanceScale(width, height);
  const innerRadius = radius * stroke.hardness;
  let maxCoverage = 0;

  for (let index = 0; index < stroke.points.length - 1; index += 1) {
    const start = stroke.points[index];
    const end = stroke.points[index + 1];
    if (start === undefined || end === undefined) continue;
    const { distance, t } = segmentDistance(x, y, start, end);
    if (!Number.isFinite(distance) || distance > radius) continue;

    const edgeWidth = Math.max(radius - innerRadius, Number.EPSILON);
    const softCoverage = distance <= innerRadius ? 1 : 1 - (distance - innerRadius) / edgeWidth;
    maxCoverage = Math.max(maxCoverage, clamp01(softCoverage) * stroke.flow * segmentPressure(start, end, t));
  }

  return clamp01(maxCoverage);
};

const buildMaskArtifact = (render: BrushMaskRenderResult) => ({
  artifactId: `artifact_${render.maskId}`,
  contentHash: render.contentHash,
  dimensions: {
    height: render.height,
    width: render.width,
  },
  kind: 'mask' as const,
  storage: 'temp_cache' as const,
});

export const renderBrushMask = (request: BrushMaskRenderRequest): BrushMaskRenderResult => {
  const parsedRequest = brushMaskRenderRequestSchema.parse(request);
  const command = parsedRequest.command;
  if (command.commandType !== 'layerMask.createBrushMask') {
    throw new Error('Brush mask runtime expected a createBrushMask command after schema validation.');
  }

  if (command.parameters.baseMaskId !== undefined && parsedRequest.baseMask?.maskId !== command.parameters.baseMaskId) {
    throw new Error('Brush mask runtime requires matching baseMask when baseMaskId is provided.');
  }

  const alpha =
    parsedRequest.baseMask === undefined
      ? new Array<number>(parsedRequest.width * parsedRequest.height).fill(0)
      : [...parsedRequest.baseMask.alpha];
  for (const stroke of command.parameters.strokes) {
    for (let y = 0; y < parsedRequest.height; y += 1) {
      for (let x = 0; x < parsedRequest.width; x += 1) {
        const index = y * parsedRequest.width + x;
        const coverage = strokeCoverage(
          pixelX(x, parsedRequest.width),
          pixelY(y, parsedRequest.height),
          stroke,
          parsedRequest.width,
          parsedRequest.height,
        );
        alpha[index] =
          stroke.mode === 'paint' ? Math.max(alpha[index] ?? 0, coverage) : (alpha[index] ?? 0) * (1 - coverage);
      }
    }
  }

  const contentHash = stableAlphaHash(alpha);
  const coverageSum = roundMetric(alpha.reduce((sum, value) => sum + value, 0));
  const pressurePointCount = command.parameters.strokes.reduce(
    (sum, stroke) => sum + stroke.points.filter((point) => point.pressure !== undefined).length,
    0,
  );
  const provenance = {
    baseMaskHash: normalizedBaseHash(parsedRequest.baseMask),
    contentHash,
    coverageSum,
    pressurePointCount,
    pressureUsed: pressurePointCount > 0,
    strokeCount: command.parameters.strokes.length,
  };

  return {
    alpha,
    contentHash,
    coverageSum,
    height: parsedRequest.height,
    maskId: buildMaskId(command),
    provenance,
    width: parsedRequest.width,
  };
};

export class BrushMaskCommandRuntime {
  readonly #acceptedDryRuns: Set<string> = new Set<string>();

  dispatch(
    command: LayerMaskCommandEnvelopeV1,
    request: Omit<BrushMaskRenderRequest, 'command'>,
  ): LayerMaskDryRunResultV1 | LayerMaskMutationResultV1 {
    const parsedCommand = layerMaskCommandEnvelopeV1Schema.parse(command);
    if (parsedCommand.commandType !== 'layerMask.createBrushMask') {
      throw new Error('Brush mask runtime only supports createBrushMask commands.');
    }

    const renderRequest = brushMaskRenderRequestSchema.parse({ ...request, command: parsedCommand });
    const render = renderBrushMask(renderRequest);
    const planKey = buildPlanKey(parsedCommand, renderRequest);
    if (parsedCommand.dryRun) {
      this.#acceptedDryRuns.add(planKey);
      return buildBrushMaskDryRunResult(parsedCommand, render);
    }

    if (!this.#acceptedDryRuns.has(planKey)) {
      throw new Error('Brush mask runtime rejected apply without a matching dry-run.');
    }

    return buildBrushMaskMutationResult(parsedCommand, render);
  }
}

export const buildBrushMaskDryRunResult = (
  command: BrushMaskCommand,
  render: BrushMaskRenderResult,
): LayerMaskDryRunResultV1 =>
  layerMaskDryRunResultV1Schema.parse({
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: true,
    maskArtifacts: [buildMaskArtifact(render)],
    mutates: false,
    parameterDiff: [
      {
        entityId: command.parameters.baseMaskId ?? null,
        entityKind: 'mask',
        path: command.parameters.baseMaskId === undefined ? '/masks/-' : `/masks/${command.parameters.baseMaskId}`,
        value: {
          maskId: render.maskId,
          maskName: command.parameters.maskName,
          provenance: render.provenance,
          strokeCount: command.parameters.strokes.length,
        },
      },
    ],
    predictedGraphRevision: `${command.expectedGraphRevision}:preview:${command.commandId}`,
    previewArtifacts: [],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings: [],
  });

export const buildBrushMaskMutationResult = (
  command: BrushMaskCommand,
  render: BrushMaskRenderResult,
): LayerMaskMutationResultV1 =>
  layerMaskMutationResultV1Schema.parse({
    appliedGraphRevision: `${command.expectedGraphRevision}:apply:${command.commandId}`,
    changedLayerIds: [],
    changedMaskIds: [render.maskId],
    changedNodeIds: [`node_${render.maskId}`],
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: false,
    maskArtifacts: [buildMaskArtifact(render)],
    maskProvenance: render.provenance,
    mutates: true,
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    undoRevision: command.expectedGraphRevision,
    warnings: [],
  });
