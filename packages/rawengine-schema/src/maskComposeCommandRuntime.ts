import { z } from 'zod';

import {
  type LayerMaskCommandEnvelopeV1,
  type LayerMaskDryRunResultV1,
  type LayerMaskMutationResultV1,
  layerMaskCommandEnvelopeV1Schema,
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
} from './rawEngineSchemas.js';

export const maskAlphaArtifactSchema = z
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
        message: 'Mask alpha artifact dimensions must match alpha length.',
        path: ['alpha'],
      });
    }
  });

export const maskComposeRenderRequestSchema = z
  .object({
    command: layerMaskCommandEnvelopeV1Schema,
    sourceMasks: z.array(maskAlphaArtifactSchema).min(2),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.command.commandType !== 'layerMask.combineMasks') {
      context.addIssue({
        code: 'custom',
        message: 'Mask compose runtime only accepts layerMask.combineMasks commands.',
        path: ['command'],
      });
    }
  });

export type MaskComposeCommand = Extract<LayerMaskCommandEnvelopeV1, { commandType: 'layerMask.combineMasks' }>;
export type MaskAlphaArtifact = z.infer<typeof maskAlphaArtifactSchema>;
export type MaskComposeRenderRequest = z.infer<typeof maskComposeRenderRequestSchema>;

export interface MaskComposeRenderResult {
  alpha: Array<number>;
  contentHash: string;
  height: number;
  maskId: string;
  sourceMaskIds: Array<string>;
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

const applyComposeMode = (
  baseWeight: number,
  sourceWeight: number,
  mode: MaskComposeCommand['parameters']['combineMode'],
) => {
  const base = clamp01(baseWeight);
  const source = clamp01(sourceWeight);
  if (mode === 'add') return 1 - (1 - base) * (1 - source);
  if (mode === 'subtract') return base * (1 - source);
  return base * source;
};

const toMaskIdSegment = (value: string): string => value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/gu, '_');

const buildMaskId = (command: MaskComposeCommand): string =>
  `mask_composed_${toMaskIdSegment(command.parameters.maskName)}`;

const normalizedSourceHash = (artifact: MaskAlphaArtifact): string =>
  artifact.contentHash ?? stableAlphaHash(artifact.alpha);

const buildSourceSignature = (sourceMasks: ReadonlyArray<MaskAlphaArtifact>): Array<Array<string | number>> =>
  sourceMasks.map((mask) => [mask.maskId, mask.width, mask.height, normalizedSourceHash(mask)]);

const buildPlanKey = (command: MaskComposeCommand, sourceMasks: ReadonlyArray<MaskAlphaArtifact>): string =>
  JSON.stringify([
    command.expectedGraphRevision,
    command.target,
    command.parameters,
    buildSourceSignature(sourceMasks),
  ]);

export const renderComposedMask = (request: MaskComposeRenderRequest): MaskComposeRenderResult => {
  const parsedRequest = maskComposeRenderRequestSchema.parse(request);
  const command = parsedRequest.command;
  if (command.commandType !== 'layerMask.combineMasks') {
    throw new Error('Mask compose runtime expected a combineMasks command after schema validation.');
  }

  const sourceById = new Map(parsedRequest.sourceMasks.map((sourceMask) => [sourceMask.maskId, sourceMask]));
  const orderedSources = command.parameters.sourceMaskIds.map((maskId) => {
    const source = sourceById.get(maskId);
    if (source === undefined) throw new Error(`Mask compose runtime missing source mask: ${maskId}`);
    return source;
  });
  const firstSource = orderedSources.at(0);
  if (firstSource === undefined) {
    throw new Error('Mask compose runtime requires at least one source mask.');
  }

  for (const source of orderedSources) {
    if (source.width !== firstSource.width || source.height !== firstSource.height) {
      throw new Error('Mask compose runtime requires source masks with matching dimensions.');
    }
  }

  const alpha = [...firstSource.alpha];
  for (const source of orderedSources.slice(1)) {
    for (let index = 0; index < alpha.length; index += 1) {
      alpha[index] = applyComposeMode(alpha[index] ?? 0, source.alpha[index] ?? 0, command.parameters.combineMode);
    }
  }

  return {
    alpha,
    contentHash: stableAlphaHash(alpha),
    height: firstSource.height,
    maskId: buildMaskId(command),
    sourceMaskIds: command.parameters.sourceMaskIds,
    width: firstSource.width,
  };
};

export class MaskComposeCommandRuntime {
  readonly #acceptedDryRuns: Set<string> = new Set<string>();

  dispatch(
    command: LayerMaskCommandEnvelopeV1,
    sourceMasks: ReadonlyArray<MaskAlphaArtifact>,
  ): LayerMaskDryRunResultV1 | LayerMaskMutationResultV1 {
    const parsedCommand = layerMaskCommandEnvelopeV1Schema.parse(command);
    if (parsedCommand.commandType !== 'layerMask.combineMasks') {
      throw new Error('Mask compose runtime only supports combineMasks commands.');
    }

    const render = renderComposedMask({ command: parsedCommand, sourceMasks: [...sourceMasks] });
    const planKey = buildPlanKey(parsedCommand, sourceMasks);
    if (parsedCommand.dryRun) {
      this.#acceptedDryRuns.add(planKey);
      return buildMaskComposeDryRunResult(parsedCommand, render);
    }

    if (!this.#acceptedDryRuns.has(planKey)) {
      throw new Error('Mask compose runtime rejected apply without a matching dry-run.');
    }

    return buildMaskComposeMutationResult(parsedCommand, render);
  }
}

export const buildMaskComposeDryRunResult = (
  command: MaskComposeCommand,
  render: MaskComposeRenderResult,
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
          combineMode: command.parameters.combineMode,
          maskId: render.maskId,
          maskName: command.parameters.maskName,
          sourceMaskIds: render.sourceMaskIds,
        },
      },
    ],
    predictedGraphRevision: `${command.expectedGraphRevision}:preview:${command.commandId}`,
    previewArtifacts: [],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings: [],
  });

export const buildMaskComposeMutationResult = (
  command: MaskComposeCommand,
  render: MaskComposeRenderResult,
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
