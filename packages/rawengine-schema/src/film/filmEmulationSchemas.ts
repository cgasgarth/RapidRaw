import { z } from 'zod';
import { filmCharacteristicCurveV1Schema } from './filmCharacteristicCurveSchemas.js';

export const filmEmulationProfileRefV1Schema = z
  .object({
    id: z.string().regex(/^rapidraw\.[a-z0-9_]+\.v\d+$/u),
    version: z.string().regex(/^\d+(?:\.\d+){0,2}$/u),
    contentSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();

export const filmResidualLutManifestV1Schema = z
  .object({
    model: z.literal('scene_log_opponent_residual_tetrahedral_v1'),
    workingSpace: z.literal('acescg_linear_v1'),
    gridSize: z.union([z.literal(17), z.literal(33)]),
    exposureDomainEv: z.tuple([z.number().finite(), z.number().finite()]),
    opponentDomain: z.tuple([
      z.tuple([z.number().finite(), z.number().finite()]),
      z.tuple([z.number().finite(), z.number().finite()]),
    ]),
    edgeFadeFraction: z.number().finite().min(0.01).max(0.5),
    neutralGateC0: z.number().finite().min(0).max(1),
    storage: z.enum(['f16_le', 'f32_le']),
    assetPath: z.string().trim().min(1),
    assetSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    decodedValueSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict()
  .superRefine((manifest, context) => {
    const domains = [manifest.exposureDomainEv, ...manifest.opponentDomain];
    domains.forEach((domain, index) => {
      if (domain[0] >= domain[1]) {
        context.addIssue({
          code: 'custom',
          message: 'Residual LUT domains must be strictly ordered.',
          path: [index === 0 ? 'exposureDomainEv' : 'opponentDomain', index === 0 ? 0 : index - 1],
        });
      }
    });
  });

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
    residualLut: filmResidualLutManifestV1Schema.optional(),
    characteristicCurve: filmCharacteristicCurveV1Schema.optional(),
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
    profileId: z.string().regex(/^rapidraw\.[a-z0-9_]+\.v\d+$/u),
    profileVersion: z.string().regex(/^\d+(?:\.\d+){0,2}$/u),
    profileContentSha256: z.string().trim().min(1),
    mix: z.number().finite().min(0).max(1),
    enabled: z.boolean(),
    postFilmPreViewHash: z.string().trim().min(1),
    fallback: z.boolean(),
    errorCode: z.string().trim().min(1).optional(),
  })
  .strict();
