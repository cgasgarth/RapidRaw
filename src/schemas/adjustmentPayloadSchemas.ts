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
  newlySentPatchIds: ReadonlySet<string>;
  payload: BackendAdjustmentPayload;
}

const maskDataKeys = ['mask_data_base64', 'maskDataBase64'] as const;

export const prepareAdjustmentPayloadForBackend = (
  value: unknown,
  patchesSentToBackend: ReadonlySet<string>,
): PreparedAdjustmentPayload => {
  const parsed = backendAdjustmentPayloadSchema.parse(value);
  const newlySentPatchIds = new Set<string>();

  const processSubMasks = (subMasks: Array<z.infer<typeof backendSubMaskPayloadSchema>> | undefined) =>
    subMasks?.map((subMask) => {
      if (!subMask.id || !subMask.parameters) return subMask;
      let parameters = subMask.parameters;
      let foundMaskData = false;
      for (const key of maskDataKeys) {
        if (subMask.parameters[key] !== undefined && subMask.parameters[key] !== null) {
          foundMaskData = true;
          if (patchesSentToBackend.has(subMask.id)) {
            if (parameters === subMask.parameters) parameters = { ...parameters };
            parameters[key] = null;
          }
        }
      }

      if (foundMaskData && !patchesSentToBackend.has(subMask.id)) {
        newlySentPatchIds.add(subMask.id);
      }
      return parameters === subMask.parameters ? subMask : { ...subMask, parameters };
    });

  const aiPatches = parsed.aiPatches?.map((patch) => {
    let nextPatch = patch;
    if (patch.id && patch.patchData && !patch.isLoading) {
      if (patchesSentToBackend.has(patch.id)) {
        nextPatch = { ...nextPatch, patchData: null };
      } else {
        newlySentPatchIds.add(patch.id);
      }
    }
    const subMasks = processSubMasks(patch.subMasks);
    return subMasks === undefined ? nextPatch : { ...nextPatch, subMasks };
  });
  const masks = parsed.masks?.map((container) => ({ ...container, subMasks: processSubMasks(container.subMasks) }));
  const payload = { ...parsed, aiPatches, masks };

  return { newlySentPatchIds, payload };
};
