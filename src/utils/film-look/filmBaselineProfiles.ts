import {
  type FilmCharacteristicCurveV1,
  referenceFilmCharacteristicCurveV1,
} from '../../../packages/rawengine-schema/src/film/filmCharacteristicCurveSchemas';
import {
  type FilmProfileManifestV1,
  filmProfileManifestV1Schema,
} from '../../../packages/rawengine-schema/src/film/filmProfileRegistrySchemas';
import { REFERENCE_FILM_PROFILE_MANIFEST } from './filmProfileRegistry';

type BaselineDefinition = {
  id: string;
  hash: string;
  displayName: string;
  family: FilmProfileManifestV1['presentation']['family'];
  tags: string[];
  description: string;
  curveScale: number;
  mix: number;
};

const baselineDefinitions: BaselineDefinition[] = [
  {
    id: 'rapidraw.soft_color_negative.v1',
    hash: 'sha256:655a5d3e64e8b1816c7fe8f2cded98be3f25756798eaa1d2d5a925d784a344fd',
    displayName: 'Soft Color Negative v1',
    family: 'color_negative',
    tags: ['negative', 'latitude', 'warm'],
    description: 'Generic engineered negative response with a broad, gentle shoulder.',
    curveScale: 0.9,
    mix: 0.9,
  },
  {
    id: 'rapidraw.clean_reversal.v1',
    hash: 'sha256:f4e9d3181c251ae7431c3936407e872effed51899b4d23631f77e6fe0fedbe07',
    displayName: 'Clean Reversal v1',
    family: 'reversal',
    tags: ['reversal', 'contrast', 'chroma'],
    description: 'Generic engineered reversal response with a steeper mid-scale.',
    curveScale: 1.12,
    mix: 0.95,
  },
  {
    id: 'rapidraw.tungsten_cinema_print.v1',
    hash: 'sha256:05bb185d0ad0a3537823292e1184684e0e2f21babf383f2fb8c38298ae4cd9ce',
    displayName: 'Tungsten Cinema Print v1',
    family: 'cinema_print',
    tags: ['tungsten', 'print', 'warm'],
    description: 'Generic engineered capture and virtual print response for tungsten scenes.',
    curveScale: 1.02,
    mix: 0.92,
  },
  {
    id: 'rapidraw.silver_monochrome.v1',
    hash: 'sha256:a2b83783469b675abe47dd8f87e42682a71b20694676f3f7a603213ef2441b36',
    displayName: 'Silver Monochrome v1',
    family: 'monochrome',
    tags: ['monochrome', 'panchromatic', 'filters'],
    description: 'Generic engineered RGB approximation for a neutral monochrome response.',
    curveScale: 1,
    mix: 1,
  },
];

const scaledCurve = (scale: number): FilmCharacteristicCurveV1 => ({
  ...referenceFilmCharacteristicCurveV1,
  responseKnots: referenceFilmCharacteristicCurveV1.responseKnots.map((value) => value * scale),
});

const buildManifest = (definition: BaselineDefinition): FilmProfileManifestV1 => {
  const profileRef = { id: definition.id, version: '1', contentSha256: definition.hash };
  return filmProfileManifestV1Schema.parse({
    schemaVersion: 1,
    profile: {
      ...profileRef,
      renderContractVersion: '1',
      workingSpace: 'acescg_linear_v1',
      lifecycle: 'active',
    },
    presentation: {
      displayName: definition.displayName,
      family: definition.family,
      tags: definition.tags,
      description: definition.description,
    },
    claim: {
      class: 'generic_engineered',
      publicStatement: 'Engineered by RapidRaw; project-authored creative baseline.',
      prohibitedClaims: ['exact_stock_match', 'manufacturer_endorsement'],
    },
    provenance: {
      authors: ['RapidRaw project'],
      sourceKind: 'project_parameters',
      sourceUrls: [],
      licenseSpdx: ['AGPL-3.0-or-later'],
      noticePaths: ['AGPL_COMPLIANCE.md'],
      assetSha256: {},
    },
    calibration: {
      status: 'engineered',
      methodVersion: 'baseline-v1',
      limitations: ['RGB tristimulus approximation; not a measured commercial process.'],
      illuminants: ['D65'],
    },
    model: {
      nodeType: 'film_emulation',
      contractVersion: 1,
      enabled: true,
      profileRef,
      stageParams: { referenceLuminanceShaperP: 0.35 },
      characteristicCurve: scaledCurve(definition.curveScale),
      mix: definition.mix,
      workingSpace: 'acescg_linear_v1',
      seedPolicy: 'source_stable_v1',
    },
  });
};

export const FILM_BASELINE_PROFILES: readonly FilmProfileManifestV1[] = [
  REFERENCE_FILM_PROFILE_MANIFEST,
  ...baselineDefinitions.map(buildManifest),
];

export const getFilmBaselineProfileCatalog = (): readonly FilmProfileManifestV1[] => FILM_BASELINE_PROFILES;

export const getFilmBaselineProfile = (id: string): FilmProfileManifestV1 | undefined =>
  FILM_BASELINE_PROFILES.find((profile) => profile.profile.id === id);
