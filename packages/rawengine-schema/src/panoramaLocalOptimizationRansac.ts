import { z } from 'zod';

const PANORAMA_LO_RANSAC_ALGORITHM_ID = 'synthetic_descriptor_translation_lo_ransac_v1';
const PANORAMA_LO_REFINEMENT_ALGORITHM_ID = 'deterministic_inlier_mean_refinement_v1';
const PANORAMA_LO_TIE_BREAK = 'first_max_consensus_lowest_match_index';

const pointSchema = z.tuple([z.number(), z.number()]);

export const panoramaLoRansacMatchV1Schema = z
  .object({
    descriptor: z.string().trim().min(1),
    left: pointSchema,
    right: pointSchema,
  })
  .strict();

export const panoramaLoRansacTranslationRequestV1Schema = z
  .object({
    inlierTolerancePx: z.number().positive(),
    matches: z.array(panoramaLoRansacMatchV1Schema),
    maxSeedModels: z.number().int().positive().optional(),
    minimumInliers: z.number().int().positive(),
  })
  .strict();

export const panoramaLoRansacTranslationResultV1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      algorithmId: z.literal(PANORAMA_LO_RANSAC_ALGORITHM_ID),
      deterministicTieBreak: z.literal(PANORAMA_LO_TIE_BREAK),
      evaluatedSeedModelCount: z.number().int().nonnegative(),
      failureCode: z.literal('insufficient_inlier_matches'),
      inlierTolerancePx: z.number().positive(),
      kind: z.literal('failure'),
      matchCount: z.number().int().nonnegative(),
      minimumInliers: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      algorithmId: z.literal(PANORAMA_LO_RANSAC_ALGORITHM_ID),
      deterministicTieBreak: z.literal(PANORAMA_LO_TIE_BREAK),
      evaluatedSeedModelCount: z.number().int().positive(),
      inlierCount: z.number().int().positive(),
      inlierTolerancePx: z.number().positive(),
      kind: z.literal('success'),
      localOptimization: z
        .object({
          algorithmId: z.literal(PANORAMA_LO_REFINEMENT_ALGORITHM_ID),
          improvedMeanInlierError: z.boolean(),
          iterationCount: z.literal(1),
          meanInlierErrorAfterPx: z.number().nonnegative(),
          meanInlierErrorBeforePx: z.number().nonnegative(),
          refinedModel: z
            .object({
              model: z.literal('translation'),
              x: z.number(),
              y: z.number(),
            })
            .strict(),
        })
        .strict(),
      matchCount: z.number().int().positive(),
      maxInlierErrorPx: z.number().nonnegative(),
      seedModel: z
        .object({
          model: z.literal('translation'),
          seedMatchIndex: z.number().int().nonnegative(),
          x: z.number(),
          y: z.number(),
        })
        .strict(),
    })
    .strict(),
]);

export type PanoramaLoRansacMatchV1 = z.infer<typeof panoramaLoRansacMatchV1Schema>;
export type PanoramaLoRansacTranslationRequestV1 = z.infer<typeof panoramaLoRansacTranslationRequestV1Schema>;
export type PanoramaLoRansacTranslationResultV1 = z.infer<typeof panoramaLoRansacTranslationResultV1Schema>;

export const estimatePanoramaLoRansacTranslationV1 = (requestValue: unknown): PanoramaLoRansacTranslationResultV1 => {
  const request = panoramaLoRansacTranslationRequestV1Schema.parse(requestValue);
  const seedLimit = Math.min(request.matches.length, request.maxSeedModels ?? request.matches.length);
  let best: { inliers: PanoramaLoRansacMatchV1[]; seedMatchIndex: number; translation: Translation2d } | null = null;

  for (let seedMatchIndex = 0; seedMatchIndex < seedLimit; seedMatchIndex += 1) {
    const match = request.matches[seedMatchIndex];
    if (match === undefined) continue;
    const translation = translationForMatch(match);
    const inliers = request.matches.filter(
      (candidate) => translationError(candidate, translation) <= request.inlierTolerancePx,
    );
    if (best === null || inliers.length > best.inliers.length) {
      best = { inliers, seedMatchIndex, translation };
    }
  }

  if (best === null || best.inliers.length < request.minimumInliers) {
    return panoramaLoRansacTranslationResultV1Schema.parse({
      algorithmId: PANORAMA_LO_RANSAC_ALGORITHM_ID,
      deterministicTieBreak: PANORAMA_LO_TIE_BREAK,
      evaluatedSeedModelCount: seedLimit,
      failureCode: 'insufficient_inlier_matches',
      inlierTolerancePx: request.inlierTolerancePx,
      kind: 'failure',
      matchCount: request.matches.length,
      minimumInliers: request.minimumInliers,
    });
  }

  const refinedTranslation = {
    x: roundMetric(average(best.inliers.map((match) => match.right[0] - match.left[0]))),
    y: roundMetric(average(best.inliers.map((match) => match.right[1] - match.left[1]))),
  };
  const meanInlierErrorBeforePx = roundMetric(
    average(best.inliers.map((match) => translationError(match, best.translation))),
  );
  const meanInlierErrorAfterPx = roundMetric(
    average(best.inliers.map((match) => translationError(match, refinedTranslation))),
  );

  return panoramaLoRansacTranslationResultV1Schema.parse({
    algorithmId: PANORAMA_LO_RANSAC_ALGORITHM_ID,
    deterministicTieBreak: PANORAMA_LO_TIE_BREAK,
    evaluatedSeedModelCount: seedLimit,
    inlierCount: best.inliers.length,
    inlierTolerancePx: request.inlierTolerancePx,
    kind: 'success',
    localOptimization: {
      algorithmId: PANORAMA_LO_REFINEMENT_ALGORITHM_ID,
      improvedMeanInlierError: meanInlierErrorAfterPx < meanInlierErrorBeforePx,
      iterationCount: 1,
      meanInlierErrorAfterPx,
      meanInlierErrorBeforePx,
      refinedModel: {
        model: 'translation',
        ...refinedTranslation,
      },
    },
    matchCount: request.matches.length,
    maxInlierErrorPx: roundMetric(
      Math.max(...best.inliers.map((match) => translationError(match, refinedTranslation))),
    ),
    seedModel: {
      model: 'translation',
      seedMatchIndex: best.seedMatchIndex,
      x: roundMetric(best.translation.x),
      y: roundMetric(best.translation.y),
    },
  });
};

interface Translation2d {
  x: number;
  y: number;
}

const translationForMatch = (match: PanoramaLoRansacMatchV1): Translation2d => ({
  x: match.right[0] - match.left[0],
  y: match.right[1] - match.left[1],
});

const translationError = (match: PanoramaLoRansacMatchV1, translation: Translation2d): number => {
  const dx = match.left[0] + translation.x - match.right[0];
  const dy = match.left[1] + translation.y - match.right[1];
  return Math.hypot(dx, dy);
};

const average = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

const roundMetric = (value: number): number => Number(value.toFixed(6));
