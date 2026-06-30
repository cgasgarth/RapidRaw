import { z } from 'zod';

import {
  type LayerMaskCommandEnvelopeV1,
  type LayerMaskDryRunResultV1,
  type LayerMaskMutationResultV1,
  layerMaskCommandEnvelopeV1Schema,
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
} from './rawEngineSchemas.js';

export const linearGradientMaskRenderRequestSchema = z
  .object({
    command: layerMaskCommandEnvelopeV1Schema,
    height: z.number().int().positive().max(16384),
    width: z.number().int().positive().max(16384),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.command.commandType !== 'layerMask.createGradientMask' ||
      request.command.parameters.gradient.gradientKind !== 'linear'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Linear gradient mask runtime only accepts layerMask.createGradientMask linear commands.',
        path: ['command'],
      });
    }
  });

export type LinearGradientMaskCommand = Extract<
  LayerMaskCommandEnvelopeV1,
  { commandType: 'layerMask.createGradientMask' }
>;
export type LinearGradientMaskRenderRequest = z.infer<typeof linearGradientMaskRenderRequestSchema>;

export interface LinearGradientMaskRenderResult {
  alpha: Array<number>;
  contentHash: string;
  height: number;
  maskId: string;
  width: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smoothStep = (value: number): number => value * value * (3 - 2 * value);
const quantizeAlpha = (value: number): number => Math.round(clamp01(value) * 255);

const stableAlphaHash = (alpha: ReadonlyArray<number>): string => {
  let hash = 0x811c9dc5;
  for (const value of alpha) {
    hash ^= quantizeAlpha(value);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
};

const toMaskIdSegment = (value: string): string => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/gu, '_');

const buildMaskId = (command: LinearGradientMaskCommand): string =>
  `mask_linear_gradient_${toMaskIdSegment(command.parameters.maskName)}`;

const buildPlanKey = (command: LinearGradientMaskCommand): string =>
  JSON.stringify([command.expectedGraphRevision, command.target, command.parameters]);

export const renderLinearGradientMask = (request: LinearGradientMaskRenderRequest): LinearGradientMaskRenderResult => {
  const parsedRequest = linearGradientMaskRenderRequestSchema.parse(request);
  const command = parsedRequest.command;
  if (command.commandType !== 'layerMask.createGradientMask' || command.parameters.gradient.gradientKind !== 'linear') {
    throw new Error('Linear gradient mask runtime expected a linear gradient command after schema validation.');
  }

  const { end, feather, invert, start } = command.parameters.gradient;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) {
    throw new Error('Linear gradient mask runtime requires distinct start and end points.');
  }

  const alpha: Array<number> = [];
  for (let y = 0; y < parsedRequest.height; y += 1) {
    const normalizedY = parsedRequest.height === 1 ? 0 : y / (parsedRequest.height - 1);
    for (let x = 0; x < parsedRequest.width; x += 1) {
      const normalizedX = parsedRequest.width === 1 ? 0 : x / (parsedRequest.width - 1);
      const projection = ((normalizedX - start.x) * dx + (normalizedY - start.y) * dy) / lengthSquared;
      const linearWeight = clamp01(projection);
      const softenedWeight =
        feather === 0 ? linearWeight : linearWeight * (1 - feather) + smoothStep(linearWeight) * feather;
      alpha.push(invert ? 1 - softenedWeight : softenedWeight);
    }
  }

  return {
    alpha,
    contentHash: stableAlphaHash(alpha),
    height: parsedRequest.height,
    maskId: buildMaskId(command),
    width: parsedRequest.width,
  };
};

export class LinearGradientMaskCommandRuntime {
  readonly #acceptedDryRuns: Set<string> = new Set<string>();
  readonly #height: number;
  readonly #width: number;

  constructor({ height, width }: { height: number; width: number }) {
    this.#height = height;
    this.#width = width;
  }

  dispatch(command: LayerMaskCommandEnvelopeV1): LayerMaskDryRunResultV1 | LayerMaskMutationResultV1 {
    const parsedCommand = layerMaskCommandEnvelopeV1Schema.parse(command);
    if (
      parsedCommand.commandType !== 'layerMask.createGradientMask' ||
      parsedCommand.parameters.gradient.gradientKind !== 'linear'
    ) {
      throw new Error('Linear gradient mask runtime only supports linear gradient mask commands.');
    }

    const render = renderLinearGradientMask({ command: parsedCommand, height: this.#height, width: this.#width });
    const planKey = buildPlanKey(parsedCommand);
    if (parsedCommand.dryRun) {
      this.#acceptedDryRuns.add(planKey);
      return buildLinearGradientMaskDryRunResult(parsedCommand, render);
    }

    if (!this.#acceptedDryRuns.has(planKey)) {
      throw new Error('Linear gradient mask runtime rejected apply without a matching dry-run.');
    }

    return buildLinearGradientMaskMutationResult(parsedCommand, render);
  }
}

export const buildLinearGradientMaskDryRunResult = (
  command: LinearGradientMaskCommand,
  render: LinearGradientMaskRenderResult,
): LayerMaskDryRunResultV1 =>
  layerMaskDryRunResultV1Schema.parse({
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: true,
    maskArtifacts: [
      {
        artifactId: `artifact_${render.maskId}`,
        contentHash: render.contentHash,
        dimensions: {
          height: render.height,
          width: render.width,
        },
        kind: 'mask',
        storage: 'temp_cache',
      },
    ],
    mutates: false,
    parameterDiff: [
      {
        entityId: null,
        entityKind: 'mask',
        path: '/masks/-',
        value: {
          gradientKind: command.parameters.gradient.gradientKind,
          maskId: render.maskId,
          maskName: command.parameters.maskName,
        },
      },
    ],
    predictedGraphRevision: `${command.expectedGraphRevision}:preview:${command.commandId}`,
    previewArtifacts: [],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings: [],
  });

export const buildLinearGradientMaskMutationResult = (
  command: LinearGradientMaskCommand,
  render: LinearGradientMaskRenderResult,
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
    mutates: true,
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    undoRevision: command.expectedGraphRevision,
    warnings: [],
  });
