import {
  type NegativeLabPaperProfile,
  type NegativeLabPaperProfileCatalog,
  negativeLabPaperProfileCatalogSchema,
  negativeLabPaperProfileSchema,
} from '../../schemas/negative-lab/negativeLabPaperProfileSchemas';

export const NEGATIVE_LAB_PAPER_PROFILE_CATALOG: NegativeLabPaperProfileCatalog =
  negativeLabPaperProfileCatalogSchema.parse({
    catalogId: 'negative_lab_paper_profile_catalog',
    catalogVersion: '2026-07-14',
    schemaVersion: 1,
    profiles: [
      {
        profileId: 'negative_lab.paper.c41.neutral.v1',
        profileVersion: 1,
        processFamily: 'c41_color_negative',
        claimClass: 'generic_starting_point',
        dMin: 0.04,
        dMax: 1.65,
        toeKnee: 0.25,
        shoulderKnee: 0.25,
        midtoneGamma: 1,
        channelCmy: [0, 0, 0],
        baseTint: [0, 0, 0],
        sourceReferences: ['rawengine_default_negative_lab_v1'],
        contentHash: 'fnv1a32:neutral_v1',
      },
      {
        profileId: 'negative_lab.paper.c41.generic_color.v1',
        profileVersion: 1,
        processFamily: 'c41_color_negative',
        claimClass: 'generic_starting_point',
        dMin: 0.06,
        dMax: 1.9,
        toeKnee: 0.38,
        shoulderKnee: 0.32,
        midtoneGamma: 1.04,
        channelCmy: [0.015, -0.01, -0.005],
        baseTint: [0.01, 0, -0.01],
        sourceReferences: ['rawengine_generic_color_paper_starting_point_v1'],
        contentHash: 'fnv1a32:generic_color_v1',
      },
    ],
  });

export const resolveNegativeLabPaperProfile = (
  profileId: string,
  catalog: NegativeLabPaperProfileCatalog = NEGATIVE_LAB_PAPER_PROFILE_CATALOG,
): NegativeLabPaperProfile => {
  const profile = catalog.profiles.find((candidate) => candidate.profileId === profileId);
  if (profile === undefined) throw new Error(`Unknown Negative Lab paper profile: ${profileId}`);
  return negativeLabPaperProfileSchema.parse(structuredClone(profile));
};

export const neutralNegativeLabPaperProfile = (): NegativeLabPaperProfile =>
  resolveNegativeLabPaperProfile('negative_lab.paper.c41.neutral.v1');
