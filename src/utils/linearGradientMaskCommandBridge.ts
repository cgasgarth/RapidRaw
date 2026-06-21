import { z } from 'zod';

import {
  ActorKind,
  ApprovalClass,
  layerMaskCommandEnvelopeV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { linearGradientMaskParametersSchema } from '../schemas/maskParameterSchemas';

export const LINEAR_GRADIENT_MASK_COMMAND_COORDINATE_SPACE = 'normalized_image' as const;

const linearGradientCommandContextSchema = z
  .object({
    expectedGraphRevision: z.string().trim().min(1),
    imagePath: z.string().trim().min(1),
    imageSize: z
      .object({
        height: z.number().positive(),
        width: z.number().positive(),
      })
      .strict(),
    maskName: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export type LinearGradientCommandContext = z.infer<typeof linearGradientCommandContextSchema>;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const normalizeCoordinate = (value: number, extent: number): number => clamp01(value / Math.max(1, extent));
const roundMetric = (value: number): number => Number(value.toFixed(6));

export function buildLinearGradientMaskCommandFromParameters(
  parameters: unknown,
  context: LinearGradientCommandContext,
  options: { dryRun: boolean },
) {
  const rawParameters = z.record(z.string(), z.unknown()).parse(parameters);
  const parsedParameters = linearGradientMaskParametersSchema.parse({
    endX: rawParameters['endX'],
    endY: rawParameters['endY'],
    range: rawParameters['range'],
    startX: rawParameters['startX'],
    startY: rawParameters['startY'],
  });
  const parsedContext = linearGradientCommandContextSchema.parse(context);
  const feather = roundMetric(Math.min(1, parsedParameters.range / Math.max(1, parsedContext.imageSize.height)));
  const command = {
    actor: {
      id: 'rapidraw-ui',
      kind: ActorKind.Ui,
      sessionId: parsedContext.sessionId,
    },
    approval: {
      approvalClass: options.dryRun ? ApprovalClass.PreviewOnly : ApprovalClass.EditApply,
      reason: options.dryRun ? 'Preview linear gradient mask.' : 'Apply linear gradient mask.',
      state: options.dryRun ? 'not_required' : 'approved',
    },
    commandId: `linear_gradient_mask_${parsedContext.operationId}_${options.dryRun ? 'preview' : 'apply'}`,
    commandType: 'layerMask.createGradientMask',
    correlationId: `linear_gradient_mask_corr_${parsedContext.operationId}`,
    dryRun: options.dryRun,
    expectedGraphRevision: parsedContext.expectedGraphRevision,
    idempotencyKey: `linear_gradient_mask_idem_${parsedContext.operationId}_${options.dryRun ? 'preview' : 'apply'}`,
    parameters: {
      gradient: {
        end: {
          x: roundMetric(normalizeCoordinate(parsedParameters.endX, parsedContext.imageSize.width)),
          y: roundMetric(normalizeCoordinate(parsedParameters.endY, parsedContext.imageSize.height)),
        },
        feather,
        gradientKind: 'linear',
        invert: false,
        start: {
          x: roundMetric(normalizeCoordinate(parsedParameters.startX, parsedContext.imageSize.width)),
          y: roundMetric(normalizeCoordinate(parsedParameters.startY, parsedContext.imageSize.height)),
        },
      },
      maskName: parsedContext.maskName,
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: parsedContext.imagePath,
      kind: 'image',
    },
  };

  const parsedCommand = layerMaskCommandEnvelopeV1Schema.parse(command);
  if (
    parsedCommand.commandType !== 'layerMask.createGradientMask' ||
    parsedCommand.parameters.gradient.gradientKind !== 'linear'
  ) {
    throw new Error('Expected linear gradient mask command.');
  }
  return parsedCommand;
}
