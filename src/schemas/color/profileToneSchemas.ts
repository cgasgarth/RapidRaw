import { z } from 'zod';

const builtInCameraProfileIdSchema = z.enum([
  'camera_standard',
  'camera_neutral',
  'camera_portrait',
  'camera_landscape',
  'linear_raw',
]);
const dcpCameraProfileIdSchema = z.custom<`dcp:${string}`>(
  (value) => typeof value === 'string' && /^dcp:[a-f0-9]{64}$/.test(value),
);
export const cameraProfileIdSchema = z.union([builtInCameraProfileIdSchema, dcpCameraProfileIdSchema]);

export const toneCurveIdSchema = z.enum(['auto_filmic', 'linear', 'soft_contrast', 'high_contrast', 'shadow_lift']);

const profileToneSettingsSchema = z
  .object({
    cameraProfile: cameraProfileIdSchema,
    toneCurve: toneCurveIdSchema,
  })
  .strict();

export type CameraProfileId = z.infer<typeof cameraProfileIdSchema>;
export type BuiltInCameraProfileId = z.infer<typeof builtInCameraProfileIdSchema>;
export type ToneCurveId = z.infer<typeof toneCurveIdSchema>;
export type ProfileToneSettings = z.infer<typeof profileToneSettingsSchema>;

export const parseProfileToneSettings = (value: unknown): ProfileToneSettings => profileToneSettingsSchema.parse(value);
