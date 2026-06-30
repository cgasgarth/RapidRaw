import { z } from 'zod';

import { jsonValueSchema } from './masks/aiMaskingSchemas';

const backendParameterBagSchema = z.record(z.string(), z.unknown());

const backendSubMaskPayloadSchema = z
  .object({
    id: z.string().optional(),
    parameters: backendParameterBagSchema.optional(),
  })
  .loose();

const backendAiPatchPayloadSchema = z
  .object({
    id: z.string().optional(),
    isLoading: z.boolean().optional(),
    patchData: jsonValueSchema.nullable().optional(),
    subMasks: z.array(backendSubMaskPayloadSchema).optional(),
  })
  .loose();

const backendMaskContainerPayloadSchema = z
  .object({
    subMasks: z.array(backendSubMaskPayloadSchema).optional(),
  })
  .loose();

export const backendAdjustmentPayloadSchema = z
  .object({
    aiPatches: z.array(backendAiPatchPayloadSchema).optional(),
    masks: z.array(backendMaskContainerPayloadSchema).optional(),
  })
  .loose();

export type BackendAdjustmentPayload = z.infer<typeof backendAdjustmentPayloadSchema>;

export interface PreparedAdjustmentPayload {
  newlySentPatchIds: Set<string>;
  payload: BackendAdjustmentPayload;
}

const maskDataKeys = ['mask_data_base64', 'maskDataBase64'] as const;

export const prepareAdjustmentPayloadForBackend = (
  value: unknown,
  patchesSentToBackend: ReadonlySet<string>,
): PreparedAdjustmentPayload => {
  const payload = backendAdjustmentPayloadSchema.parse(value);
  const newlySentPatchIds = new Set<string>();

  const processSubMasks = (subMasks: Array<z.infer<typeof backendSubMaskPayloadSchema>> | undefined) => {
    if (!subMasks) return;

    for (const subMask of subMasks) {
      if (!subMask.id || !subMask.parameters) continue;

      let foundMaskData = false;
      for (const key of maskDataKeys) {
        if (subMask.parameters[key] !== undefined && subMask.parameters[key] !== null) {
          foundMaskData = true;
          if (patchesSentToBackend.has(subMask.id)) {
            subMask.parameters[key] = null;
          }
        }
      }

      if (foundMaskData && !patchesSentToBackend.has(subMask.id)) {
        newlySentPatchIds.add(subMask.id);
      }
    }
  };

  for (const patch of payload.aiPatches ?? []) {
    if (patch.id && patch.patchData && !patch.isLoading) {
      if (patchesSentToBackend.has(patch.id)) {
        patch.patchData = null;
      } else {
        newlySentPatchIds.add(patch.id);
      }
    }

    processSubMasks(patch.subMasks);
  }

  for (const container of payload.masks ?? []) {
    processSubMasks(container.subMasks);
  }

  return { newlySentPatchIds, payload };
};
