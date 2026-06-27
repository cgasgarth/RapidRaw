import { z } from 'zod';

import type { Adjustments } from '../utils/adjustments';

const legacyAdjustmentSnapshotSchema = z.custom<Partial<Adjustments>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  { message: 'Expected adjustment snapshot object' },
);

const nullAdjustmentSnapshotSchema = z
  .object({
    is_null: z.literal(true),
  })
  .loose();

const exifSchema = z.record(z.string(), z.string()).nullable();

export const rawDemosaicPathSchema = z.enum(['bayer_hq', 'fast', 'linear_bypass', 'standard']);

export const rawCameraProfileStatusSchema = z.enum(['fallback', 'interpolated', 'single_illuminant', 'unavailable']);

export const rawCameraProfileReportSchema = z
  .object({
    algorithmId: z.string().trim().min(1),
    candidateCount: z.number().int().nonnegative(),
    coolIlluminant: z.string().trim().min(1).nullable().optional(),
    coolWeight: z.number().min(0).max(1).nullable().optional(),
    estimatedCctKelvin: z.number().positive().nullable().optional(),
    fallbackReason: z.string().trim().min(1).nullable().optional(),
    matrixHash: z
      .string()
      .regex(/^blake3:[0-9a-f]+$/u)
      .nullable()
      .optional(),
    status: rawCameraProfileStatusSchema,
    warmIlluminant: z.string().trim().min(1).nullable().optional(),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

export const rawDevelopmentReportSchema = z
  .object({
    cameraProfile: rawCameraProfileReportSchema,
    demosaicPath: rawDemosaicPathSchema,
  })
  .strict();

export const rawCameraProfileProvenanceReceiptSchema = z
  .object({
    algorithmId: rawCameraProfileReportSchema.shape.algorithmId,
    candidateCount: rawCameraProfileReportSchema.shape.candidateCount,
    coolIlluminant: rawCameraProfileReportSchema.shape.coolIlluminant,
    coolWeight: rawCameraProfileReportSchema.shape.coolWeight,
    demosaicPath: rawDemosaicPathSchema,
    estimatedCctKelvin: rawCameraProfileReportSchema.shape.estimatedCctKelvin,
    fallbackReason: rawCameraProfileReportSchema.shape.fallbackReason,
    matrixHash: rawCameraProfileReportSchema.shape.matrixHash,
    receiptVersion: z.literal(1),
    status: rawCameraProfileStatusSchema,
    warmIlluminant: rawCameraProfileReportSchema.shape.warmIlluminant,
    warningCount: z.number().int().nonnegative(),
  })
  .strict();

export const loadedMetadataSchema = z
  .object({
    adjustments: z.union([legacyAdjustmentSnapshotSchema, nullAdjustmentSnapshotSchema]).nullable().optional(),
  })
  .loose();

export const loadImageResultSchema = z
  .object({
    exif: exifSchema.optional(),
    height: z.number().nonnegative(),
    is_offline_smart_preview: z.boolean().optional(),
    is_raw: z.boolean(),
    metadata: z.unknown().optional(),
    raw_development_report: rawDevelopmentReportSchema.nullable().optional(),
    width: z.number().nonnegative(),
  })
  .loose();

export type LoadedMetadata = z.infer<typeof loadedMetadataSchema>;
export type LoadImageResult = z.infer<typeof loadImageResultSchema>;
export type RawCameraProfileProvenanceReceipt = z.infer<typeof rawCameraProfileProvenanceReceiptSchema>;
export type RawDevelopmentReport = z.infer<typeof rawDevelopmentReportSchema>;

export const isNullAdjustmentSnapshot = (
  value: LoadedMetadata['adjustments'],
): value is z.infer<typeof nullAdjustmentSnapshotSchema> =>
  typeof value === 'object' && value !== null && 'is_null' in value && value.is_null === true;

export const parseLoadedMetadata = (value: unknown): LoadedMetadata => loadedMetadataSchema.parse(value);

export const parseLoadImageResult = (value: unknown): LoadImageResult => loadImageResultSchema.parse(value);
