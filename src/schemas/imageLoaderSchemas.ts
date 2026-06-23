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
    width: z.number().nonnegative(),
  })
  .loose();

export type LoadedMetadata = z.infer<typeof loadedMetadataSchema>;
export type LoadImageResult = z.infer<typeof loadImageResultSchema>;

export const isNullAdjustmentSnapshot = (
  value: LoadedMetadata['adjustments'],
): value is z.infer<typeof nullAdjustmentSnapshotSchema> =>
  typeof value === 'object' && value !== null && 'is_null' in value && value.is_null === true;

export const parseLoadedMetadata = (value: unknown): LoadedMetadata => loadedMetadataSchema.parse(value);

export const parseLoadImageResult = (value: unknown): LoadImageResult => loadImageResultSchema.parse(value);
