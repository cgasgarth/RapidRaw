import { z } from 'zod';

import { toMaskParameterRecord, type MaskParameterRecord } from './maskParameterAccess';

export const maskRefinementParametersCommandSchema = z
  .object({
    density: z.number().min(0).max(1),
    edgeContrast: z.number().min(0).max(1),
    edgeShiftPx: z.number().min(-512).max(512),
    featherPx: z.number().min(0).max(4096),
    smoothness: z.number().min(0).max(1),
  })
  .strict();

export const maskRefinementUiCommandSchema = z
  .object({
    commandType: z.literal('layerMask.refineMask'),
    parameters: z
      .object({
        maskId: z.string().trim().min(1),
        refinement: maskRefinementParametersCommandSchema,
      })
      .strict(),
    schemaVersion: z.literal(1),
  })
  .strict();

export type MaskRefinementUiCommand = z.infer<typeof maskRefinementUiCommandSchema>;

export const MASK_REFINEMENT_REPLAY_PARAMETER_KEY = 'refinementReplayCommand';

const DEFAULT_REFINEMENT_PARAMETERS: z.infer<typeof maskRefinementParametersCommandSchema> = {
  density: 1,
  edgeContrast: 0,
  edgeShiftPx: 0,
  featherPx: 0,
  smoothness: 0,
};

const readFiniteNumber = (record: MaskParameterRecord, key: keyof typeof DEFAULT_REFINEMENT_PARAMETERS): number => {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_REFINEMENT_PARAMETERS[key];
};

export function createMaskRefinementCommand(
  maskId: string,
  currentParameters: unknown,
  changes: Partial<Record<keyof typeof DEFAULT_REFINEMENT_PARAMETERS, number>>,
): MaskRefinementUiCommand {
  const current = toMaskParameterRecord(currentParameters);
  return maskRefinementUiCommandSchema.parse({
    commandType: 'layerMask.refineMask',
    parameters: {
      maskId,
      refinement: {
        density: changes.density ?? readFiniteNumber(current, 'density'),
        edgeContrast: changes.edgeContrast ?? readFiniteNumber(current, 'edgeContrast'),
        edgeShiftPx: changes.edgeShiftPx ?? readFiniteNumber(current, 'edgeShiftPx'),
        featherPx: changes.featherPx ?? readFiniteNumber(current, 'featherPx'),
        smoothness: changes.smoothness ?? readFiniteNumber(current, 'smoothness'),
      },
    },
    schemaVersion: 1,
  });
}

export function dispatchMaskRefinementCommand(command: MaskRefinementUiCommand): MaskParameterRecord {
  const parsed = maskRefinementUiCommandSchema.parse(command);
  return {
    ...parsed.parameters.refinement,
    [MASK_REFINEMENT_REPLAY_PARAMETER_KEY]: {
      command: parsed,
      replaySchemaVersion: 1,
    },
  };
}
