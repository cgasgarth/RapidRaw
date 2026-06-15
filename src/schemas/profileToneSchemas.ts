import { z } from 'zod';

export const cameraProfileIdSchema = z.enum([
  'camera_standard',
  'camera_neutral',
  'camera_portrait',
  'camera_landscape',
  'linear_raw',
]);

export const toneCurveIdSchema = z.enum(['auto_filmic', 'linear', 'soft_contrast', 'high_contrast', 'shadow_lift']);

export const profileToneSettingsSchema = z
  .object({
    cameraProfile: cameraProfileIdSchema,
    toneCurve: toneCurveIdSchema,
  })
  .strict();

export type CameraProfileId = z.infer<typeof cameraProfileIdSchema>;
export type ToneCurveId = z.infer<typeof toneCurveIdSchema>;
export type ProfileToneSettings = z.infer<typeof profileToneSettingsSchema>;

export const parseProfileToneSettings = (value: unknown): ProfileToneSettings => profileToneSettingsSchema.parse(value);
