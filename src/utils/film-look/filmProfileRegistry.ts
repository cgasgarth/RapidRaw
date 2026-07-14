import {
  evaluateFilmProfileClaim,
  type FilmProfileClaimDecisionV1,
  type FilmProfileManifestV1,
  filmProfileManifestV1Schema,
} from '../../../packages/rawengine-schema/src/film/filmProfileRegistrySchemas';

export const REFERENCE_FILM_PROFILE_MANIFEST: FilmProfileManifestV1 = filmProfileManifestV1Schema.parse({
  schemaVersion: 1,
  profile: {
    id: 'rapidraw.reference_film.v1',
    version: '1',
    contentSha256: 'sha256:d84121641d1318f3be759fb5705f04f01721cd35a57e1b238343590bc2b988ef',
    renderContractVersion: '1',
    workingSpace: 'acescg_linear_v1',
    lifecycle: 'active',
  },
  presentation: {
    displayName: 'Reference Film',
    family: 'generic',
    tags: ['reference'],
    description: 'Generic engineered creative film response.',
  },
  claim: {
    class: 'generic_engineered',
    publicStatement: 'Generic engineered starting point; no stock or endorsement claim.',
    prohibitedClaims: ['exact_stock_match'],
  },
  provenance: {
    authors: ['RapidRaw project'],
    sourceKind: 'project_parameters',
    sourceUrls: [],
    licenseSpdx: ['AGPL-3.0-or-later'],
    noticePaths: ['AGPL_COMPLIANCE.md'],
    assetSha256: {},
  },
  calibration: { status: 'engineered', methodVersion: '1', limitations: ['Not measured stock emulation.'] },
  model: {
    nodeType: 'film_emulation',
    contractVersion: 1,
    enabled: true,
    profileRef: {
      id: 'rapidraw.reference_film.v1',
      version: '1',
      contentSha256: 'sha256:d84121641d1318f3be759fb5705f04f01721cd35a57e1b238343590bc2b988ef',
    },
    mix: 1,
    workingSpace: 'acescg_linear_v1',
    seedPolicy: 'source_stable_v1',
  },
});

export const getReferenceFilmProfileClaimDecision = (): FilmProfileClaimDecisionV1 =>
  evaluateFilmProfileClaim(REFERENCE_FILM_PROFILE_MANIFEST);
