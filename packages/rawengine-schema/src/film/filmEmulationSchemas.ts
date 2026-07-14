import { z } from 'zod';

export const filmEmulationProfileRefV1Schema = z
  .object({
    id: z.literal('rapidraw.reference_film.v1'),
    version: z.literal('1'),
    contentSha256: z.literal('sha256:d84121641d1318f3be759fb5705f04f01721cd35a57e1b238343590bc2b988ef'),
  })
  .strict();

export const filmEmulationNodeV1Schema = z
  .object({
    nodeType: z.literal('film_emulation'),
    contractVersion: z.literal(1),
    enabled: z.boolean(),
    profileRef: filmEmulationProfileRefV1Schema,
    stageParams: z
      .object({
        referenceLuminanceShaperP: z.number().finite().min(0.0001).max(4),
      })
      .strict()
      .optional(),
    mix: z.number().finite().min(0).max(1),
    workingSpace: z.literal('acescg_linear_v1'),
    seedPolicy: z.literal('source_stable_v1'),
  })
  .strict();

export const filmSceneInputV1Schema = z
  .object({
    domain: z.literal('acescg_linear_v1'),
    encoding: z.literal('linear'),
    polarity: z.literal('positive'),
    inputTransformReceiptSha256: z.string().trim().min(1),
    extendedRangeFinite: z.literal(true),
  })
  .strict();

export const filmEmulationReceiptV1Schema = z
  .object({
    contractVersion: z.literal(1),
    inputDomain: z.literal('acescg_linear_v1'),
    outputDomain: z.literal('acescg_linear_v1'),
    nodeType: z.literal('film_emulation'),
    profileId: z.literal('rapidraw.reference_film.v1'),
    profileVersion: z.literal('1'),
    profileContentSha256: z.string().trim().min(1),
    mix: z.number().finite().min(0).max(1),
    enabled: z.boolean(),
    postFilmPreViewHash: z.string().trim().min(1),
    fallback: z.boolean(),
    errorCode: z.string().trim().min(1).optional(),
  })
  .strict();
