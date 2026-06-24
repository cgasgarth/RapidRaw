import { z } from 'zod';

export const activeDisplayProfileStatusSchema = z.enum([
  'active_profile_loaded',
  'fallback_no_active_profile',
  'unsupported_platform',
]);

export const activeDisplayProfileSchema = z
  .object({
    cmm: z.string().min(1),
    displayId: z.number().int().nonnegative().nullable().optional(),
    iccSha256: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .nullable()
      .optional(),
    profileByteCount: z.number().int().nonnegative().nullable().optional(),
    source: z.string().min(1),
    status: activeDisplayProfileStatusSchema,
  })
  .strict();

export type ActiveDisplayProfile = z.infer<typeof activeDisplayProfileSchema>;
