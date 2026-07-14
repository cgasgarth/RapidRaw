import { z } from 'zod';

import { negativeLabAcquisitionProfileSchema } from './negativeLabAcquisitionProfileSchemas';
import { negativeLabProfileProvenanceHashSchema } from './negativeLabAppServerSchemas';
import { negativeLabFrameExposureOverridePayloadSchema } from './negativeLabFrameExposureOverrideSchemas';
import {
  negativeLabAcquisitionSourceFamilySchema,
  negativeLabAcquisitionWarningCodeSchema,
} from './negativeLabFrameHealthSchemas';
import { negativeLabFrameRgbBalanceOverridePayloadSchema } from './negativeLabFrameRgbBalanceOverrideSchemas';
import { negativeLabPatchSamplerCorrectionPayloadSchema } from './negativeLabPatchSamplerCorrectionSchemas';
import { negativeLabColorFinishMetricsSchema, negativeLabPresetParamsSchema } from './negativeLabPresetCatalogSchemas';
import { negativeLabSelectedProfileSnapshotSchema } from './negativeLabProfileComparisonSchemas';

const fnv64HashSchema = z.string().regex(/^fnv1a64:[a-f0-9]{16}$/u);
const negativeLabOutputFormatIdSchema = z.enum(['jpeg_proof', 'tiff16']);
const negativeLabRenderIntentSchema = z.enum(['print', 'flat_log_master']);
const negativeLabFlatLogMasterSchema = z
  .object({ algorithmVersion: z.literal(1), gain: z.number().min(0.1).max(2), lift: z.number().min(0).max(0.25) })
  .strict();

export const negativeLabConversionBundleOutputSchema = z
  .object({
    contentHash: fnv64HashSchema,
    dimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
    filename: z.string().trim().min(1),
    format: negativeLabOutputFormatIdSchema,
    renderIntent: negativeLabRenderIntentSchema.default('print'),
    path: z.string().trim().min(1),
    sidecarFilename: z.string().trim().min(1),
    sidecarPath: z.string().trim().min(1),
    source: z
      .object({
        contentHash: fnv64HashSchema,
        filename: z.string().trim().min(1),
        path: z.string().trim().min(1),
      })
      .strict(),
  })
  // Native output evidence grows independently of replay identity. Preserve
  // unknown evidence fields while keeping the envelope and conversion strict.
  .passthrough();

export const negativeLabConversionBundleSchema = z
  .object({
    acquisition: z
      .object({
        selectedProfile: negativeLabAcquisitionProfileSchema,
        sourceFamilies: z.array(negativeLabAcquisitionSourceFamilySchema),
        warningCodes: z.array(negativeLabAcquisitionWarningCodeSchema),
      })
      .strict(),
    conversion: z
      .object({
        acceptedDryRunPlanHash: z
          .string()
          .regex(/^fnv1a32:[a-f0-9]{8}$/u)
          .nullable(),
        acceptedDryRunPlanId: z
          .string()
          .regex(/^negative_lab_batch_plan_[a-f0-9]{8}$/u)
          .nullable(),
        colorFinishMetrics: negativeLabColorFinishMetricsSchema.optional(),
        frameExposureOverrides: negativeLabFrameExposureOverridePayloadSchema.default({
          overrides: [],
          schemaVersion: 1,
        }),
        frameRgbBalanceOverrides: negativeLabFrameRgbBalanceOverridePayloadSchema.default({
          overrides: [],
          schemaVersion: 1,
        }),
        outputFormat: negativeLabOutputFormatIdSchema,
        flatLogMaster: negativeLabFlatLogMasterSchema.default({ algorithmVersion: 1, gain: 1, lift: 0.02 }),
        patchSamplerCorrections: negativeLabPatchSamplerCorrectionPayloadSchema.default({
          corrections: [],
          schemaVersion: 1,
        }),
        params: negativeLabPresetParamsSchema,
        profileProvenanceHash: negativeLabProfileProvenanceHashSchema.nullable(),
        selectedProfile: negativeLabSelectedProfileSnapshotSchema.nullable(),
        suffix: z.string().trim().min(1).max(40),
        renderIntent: negativeLabRenderIntentSchema.default('print'),
      })
      .strict(),
    doesNotProve: z
      .array(
        z.enum([
          'cryptographic_authenticity',
          'embedded_source_pixels',
          'external_source_relinking',
          'named_stock_colorimetric_match',
          'zip_archive_packaging',
        ]),
      )
      .min(5),
    outputs: z.array(negativeLabConversionBundleOutputSchema).min(1),
    replay: z
      .object({
        appServerCommand: z.literal('negative.lab.conversion_plan'),
        identityHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
        requiresSourceFiles: z.literal(true),
      })
      .strict(),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((bundle, context) => {
    if (bundle.conversion.selectedProfile !== null) {
      const selectedHash = bundle.conversion.selectedProfile.profileProvenanceHash;
      if (bundle.conversion.profileProvenanceHash !== selectedHash) {
        context.addIssue({
          code: 'custom',
          message: 'Selected profile provenance must match conversion profile provenance.',
          path: ['conversion', 'selectedProfile'],
        });
      }
    }

    if (bundle.conversion.acceptedDryRunPlanHash !== null) {
      const expectedPlanId = `negative_lab_batch_plan_${bundle.conversion.acceptedDryRunPlanHash.replace('fnv1a32:', '')}`;
      if (bundle.conversion.acceptedDryRunPlanId !== expectedPlanId) {
        context.addIssue({
          code: 'custom',
          message: 'Accepted dry-run plan id must match the accepted hash.',
          path: ['conversion', 'acceptedDryRunPlanId'],
        });
      }
    }
  });

export type NegativeLabConversionBundle = z.infer<typeof negativeLabConversionBundleSchema>;

export const parseNegativeLabConversionBundle = (value: unknown): NegativeLabConversionBundle =>
  negativeLabConversionBundleSchema.parse(value);
