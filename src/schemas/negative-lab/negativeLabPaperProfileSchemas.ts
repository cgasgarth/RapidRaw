import { z } from 'zod';

export const negativeLabPaperProfileIdSchema = z
  .string()
  .regex(/^negative_lab\.paper\.(?:c41|bw)\.[a-z0-9_]+\.v[0-9]+$/u);

export const negativeLabPaperProfileSchema = z
  .object({
    profileId: negativeLabPaperProfileIdSchema,
    profileVersion: z.literal(1),
    processFamily: z.enum(['c41_color_negative', 'black_and_white_silver_negative']),
    claimClass: z.enum(['generic_starting_point', 'fixture_measured', 'user_measured']),
    dMin: z.number().min(0).max(1),
    dMax: z.number().min(0.8).max(3),
    toeKnee: z.number().min(0.01).max(1),
    shoulderKnee: z.number().min(0.01).max(1),
    midtoneGamma: z.number().min(0.5).max(2),
    channelCmy: z.tuple([
      z.number().min(-0.25).max(0.25),
      z.number().min(-0.25).max(0.25),
      z.number().min(-0.25).max(0.25),
    ]),
    baseTint: z.tuple([
      z.number().min(-0.25).max(0.25),
      z.number().min(-0.25).max(0.25),
      z.number().min(-0.25).max(0.25),
    ]),
    sourceReferences: z.array(z.string().trim().min(1)).min(1),
    contentHash: z.string().regex(/^fnv1a32:[a-z0-9_]+$/u),
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.dMax <= profile.dMin + 0.8)
      context.addIssue({ code: 'custom', message: 'Paper profile density span must stay positive.', path: ['dMax'] });
    if (
      profile.processFamily === 'black_and_white_silver_negative' &&
      profile.channelCmy.some((value) => value !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'B&W paper profiles must not carry color channel crossover.',
        path: ['channelCmy'],
      });
    }
  });

export const negativeLabPaperProfileCatalogSchema = z
  .object({
    catalogId: z.literal('negative_lab_paper_profile_catalog'),
    catalogVersion: z.string().min(1),
    profiles: z.array(negativeLabPaperProfileSchema).min(2),
    schemaVersion: z.literal(1),
  })
  .strict();

export type NegativeLabPaperProfile = z.infer<typeof negativeLabPaperProfileSchema>;
export type NegativeLabPaperProfileCatalog = z.infer<typeof negativeLabPaperProfileCatalogSchema>;
