import { z } from 'zod';

import { negativeLabAcquisitionProfileIdSchema } from './negativeLabAcquisitionProfileSchemas';
import {
  NEGATIVE_LAB_FRAME_EXPOSURE_MAX_EV,
  NEGATIVE_LAB_FRAME_EXPOSURE_MIN_EV,
} from './negativeLabFrameExposureOverrideSchemas';
import { negativeLabFrameCropStatusSchema } from './negativeLabFrameHealthSchemas';
import { negativeLabFrameRgbBalanceOffsetSchema } from './negativeLabFrameRgbBalanceOverrideSchemas';
import { negativeLabPatchSamplerCorrectionPayloadSchema } from './negativeLabPatchSamplerCorrectionSchemas';
import { negativeLabPresetIdSchema, negativeLabPresetParamsSchema } from './negativeLabPresetCatalogSchemas';

export const NEGATIVE_LAB_SESSION_STATE_SCHEMA_VERSION = 1;

export const negativeLabSessionSaveOptionsSchema = z
  .object({
    outputFormat: z.enum(['jpeg_proof', 'tiff16']),
    suffix: z.string(),
    writeConversionBundle: z.boolean(),
  })
  .strict();

export const negativeLabSessionFrameStateSchema = z
  .object({
    cropStatus: negativeLabFrameCropStatusSchema.nullable(),
    exposureOffset: z
      .number()
      .min(NEGATIVE_LAB_FRAME_EXPOSURE_MIN_EV)
      .max(NEGATIVE_LAB_FRAME_EXPOSURE_MAX_EV)
      .nullable(),
    included: z.boolean(),
    qcDecision: z.enum(['approved', 'rejected']).nullable(),
    rgbBalanceOffset: negativeLabFrameRgbBalanceOffsetSchema.nullable(),
  })
  .strict();

export const negativeLabSessionRecipeStateSchema = z
  .object({
    conversionScope: z.enum(['active', 'all', 'ready']),
    openSavedPositiveInEditor: z.boolean(),
    params: negativeLabPresetParamsSchema,
    patchSamplerCorrectionPayload: negativeLabPatchSamplerCorrectionPayloadSchema,
    saveOptions: negativeLabSessionSaveOptionsSchema,
    selectedAcquisitionProfileId: negativeLabAcquisitionProfileIdSchema,
    selectedPresetId: z.union([negativeLabPresetIdSchema, z.literal('')]),
  })
  .strict();

export const negativeLabSessionPlanStateSchema = z
  .object({
    acceptedApplyPlanFingerprint: z.string().trim().min(1).nullable(),
    acceptedSessionRevision: z.number().int().nonnegative().nullable(),
    rollNormalizationRestoreRevision: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((state, context) => {
    const hasAcceptedFingerprint = state.acceptedApplyPlanFingerprint !== null;
    const hasAcceptedRevision = state.acceptedSessionRevision !== null;
    if (hasAcceptedFingerprint !== hasAcceptedRevision) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab accepted plan fingerprint and revision must be stored together.',
        path: ['acceptedApplyPlanFingerprint'],
      });
    }
  });

export const negativeLabSessionStateSchema = z
  .object({
    activePath: z.string().trim().min(1).nullable(),
    frameStateByPath: z.record(z.string().trim().min(1), negativeLabSessionFrameStateSchema),
    planState: negativeLabSessionPlanStateSchema,
    recipeState: negativeLabSessionRecipeStateSchema,
    sessionId: z.string().trim().min(1),
    sessionRevision: z.number().int().nonnegative(),
    targetPaths: z.array(z.string().trim().min(1)),
    version: z.literal(NEGATIVE_LAB_SESSION_STATE_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((state, context) => {
    const uniqueTargetPaths = new Set(state.targetPaths);
    if (uniqueTargetPaths.size !== state.targetPaths.length) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab session target paths must be unique.',
        path: ['targetPaths'],
      });
    }

    if (state.activePath !== null && !uniqueTargetPaths.has(state.activePath)) {
      context.addIssue({
        code: 'custom',
        message: 'Negative Lab session active path must remain in the target path set.',
        path: ['activePath'],
      });
    }

    for (const path of Object.keys(state.frameStateByPath)) {
      if (!uniqueTargetPaths.has(path)) {
        context.addIssue({
          code: 'custom',
          message: 'Negative Lab session frame state must belong to an active target path.',
          path: ['frameStateByPath', path],
        });
      }
    }
  });

export type NegativeLabSessionSaveOptions = z.infer<typeof negativeLabSessionSaveOptionsSchema>;
export type NegativeLabSessionFrameState = z.infer<typeof negativeLabSessionFrameStateSchema>;
export type NegativeLabSessionRecipeState = z.infer<typeof negativeLabSessionRecipeStateSchema>;
export type NegativeLabSessionPlanState = z.infer<typeof negativeLabSessionPlanStateSchema>;
export type NegativeLabSessionState = z.infer<typeof negativeLabSessionStateSchema>;

export const parseNegativeLabSessionState = (value: unknown): NegativeLabSessionState =>
  negativeLabSessionStateSchema.parse(value);
