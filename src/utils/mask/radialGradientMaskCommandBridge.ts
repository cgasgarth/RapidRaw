import { z } from 'zod';
import {
  ActorKind,
  ApprovalClass,
  layerMaskCommandEnvelopeV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { radialGradientMaskParametersSchema } from '../../schemas/masks/maskParameterSchemas';

export const RADIAL_GRADIENT_MASK_COMMAND_COORDINATE_SPACE = 'normalized_image' as const;

const contextSchema = z
  .object({
    expectedGraphRevision: z.string().trim().min(1),
    imagePath: z.string().trim().min(1),
    imageSize: z.object({ height: z.number().positive(), width: z.number().positive() }).strict(),
    maskName: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export type RadialGradientCommandContext = z.infer<typeof contextSchema>;
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const normalized = (value: number, extent: number): number => clamp01(value / Math.max(1, extent));
const roundMetric = (value: number): number => Number(value.toFixed(6));

export const buildRadialGradientMaskCommandFromParameters = (
  parameters: unknown,
  context: RadialGradientCommandContext,
  options: { dryRun: boolean },
) => {
  const raw = z.record(z.string(), z.unknown()).parse(parameters);
  const parsed = radialGradientMaskParametersSchema.parse({
    centerX: raw['centerX'],
    centerY: raw['centerY'],
    feather: raw['feather'],
    radiusX: raw['radiusX'],
    radiusY: raw['radiusY'],
    rotation: raw['rotation'],
  });
  const invert = raw['invert'] === true;
  const parsedContext = contextSchema.parse(context);
  const command = {
    actor: { id: 'rapidraw-ui', kind: ActorKind.Ui, sessionId: parsedContext.sessionId },
    approval: {
      approvalClass: options.dryRun ? ApprovalClass.PreviewOnly : ApprovalClass.EditApply,
      reason: options.dryRun ? 'Preview radial gradient mask.' : 'Apply radial gradient mask.',
      state: options.dryRun ? 'not_required' : 'approved',
    },
    commandId: `radial_gradient_mask_${parsedContext.operationId}_${options.dryRun ? 'preview' : 'apply'}`,
    commandType: 'layerMask.createGradientMask',
    correlationId: `radial_gradient_mask_corr_${parsedContext.operationId}`,
    dryRun: options.dryRun,
    expectedGraphRevision: parsedContext.expectedGraphRevision,
    idempotencyKey: `radial_gradient_mask_idem_${parsedContext.operationId}_${options.dryRun ? 'preview' : 'apply'}`,
    parameters: {
      gradient: {
        center: {
          x: roundMetric(normalized(parsed.centerX, parsedContext.imageSize.width)),
          y: roundMetric(normalized(parsed.centerY, parsedContext.imageSize.height)),
        },
        feather: roundMetric(parsed.feather),
        gradientKind: 'radial',
        invert,
        radiusX: roundMetric(normalized(parsed.radiusX, parsedContext.imageSize.width)),
        radiusY: roundMetric(normalized(parsed.radiusY, parsedContext.imageSize.height)),
        rotation: roundMetric(parsed.rotation),
      },
      maskName: parsedContext.maskName,
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { imagePath: parsedContext.imagePath, kind: 'image' },
  };
  const parsedCommand = layerMaskCommandEnvelopeV1Schema.parse(command);
  if (
    parsedCommand.commandType !== 'layerMask.createGradientMask' ||
    parsedCommand.parameters.gradient.gradientKind !== 'radial'
  )
    throw new Error('Expected radial gradient mask command.');
  return parsedCommand;
};
