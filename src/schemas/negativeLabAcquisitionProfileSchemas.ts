import { z } from 'zod';

export const negativeLabAcquisitionProfileIdSchema = z.enum([
  'camera_raw_linear_v1',
  'dng_linear_camera_v1',
  'scanner_tiff_16bit_flat_v1',
  'scanner_rgb_jpeg_review_v1',
]);

export const negativeLabAcquisitionProfileSchema = z
  .object({
    channelBasis: z.enum(['camera_rgb', 'scanner_rgb', 'rendered_rgb']),
    displayName: z.string().trim().min(1).max(80),
    id: negativeLabAcquisitionProfileIdSchema,
    inputTransform: z.enum(['linear_camera_raw', 'linear_dng', 'scanner_rgb_flat', 'rendered_rgb_review_only']),
    provenanceSummary: z.string().trim().min(1).max(220),
    warningCodes: z.array(z.enum(['auto_corrections_unknown', 'lossy_review_only', 'scanner_profile_unmeasured'])),
  })
  .strict();

export const negativeLabAcquisitionProfilesSchema = z.array(negativeLabAcquisitionProfileSchema).min(1);

export type NegativeLabAcquisitionProfile = z.infer<typeof negativeLabAcquisitionProfileSchema>;
export type NegativeLabAcquisitionProfileId = z.infer<typeof negativeLabAcquisitionProfileIdSchema>;
