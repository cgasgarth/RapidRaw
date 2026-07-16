import { describe, expect, test } from 'bun:test';

import {
  editDocumentV2CopyPayloadSchema,
  editDocumentV2Schema,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import { filmProfileManifestV1Schema } from '../../../packages/rawengine-schema/src/film/filmProfileRegistrySchemas';
import {
  filmBlackAndWhiteModelV1Schema,
  filmGlowModelV1Schema,
  filmGrainModelV1Schema,
  filmHalationModelV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas';
import {
  sampleFilmBlackAndWhiteModelV1,
  sampleFilmGlowModelV1,
  sampleFilmGrainModelV1,
  sampleFilmHalationModelV1,
} from '../../../packages/rawengine-schema/src/samplePayloads';
import { parsePresetLibrary } from '../../../src/utils/editDocumentPreset';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import { getFilmBaselineProfileCatalog } from '../../../src/utils/film-look/filmBaselineProfiles';

const removedModelIds = [
  'legacy_rapidraw_red_fringe_v0',
  'legacy_rapidraw_glow_bloom_v0',
  'legacy_rapidraw_desaturate_v0',
  'legacy_rapidraw_luma_noise_v0',
] as const;

describe('current Film effect-model contract', () => {
  test('accepts every current HEAD-created model', () => {
    expect(filmHalationModelV1Schema.safeParse(sampleFilmHalationModelV1).success).toBe(true);
    expect(filmGlowModelV1Schema.safeParse(sampleFilmGlowModelV1).success).toBe(true);
    expect(filmBlackAndWhiteModelV1Schema.safeParse(sampleFilmBlackAndWhiteModelV1).success).toBe(true);
    expect(filmGrainModelV1Schema.safeParse(sampleFilmGrainModelV1).success).toBe(true);
  });

  test('rejects removed RapidRaw model identifiers without substitution', () => {
    expect(
      filmHalationModelV1Schema.safeParse({
        ...sampleFilmHalationModelV1,
        algorithm: 'legacy_rapidraw_red_fringe_v0',
      }).success,
    ).toBe(false);
    expect(
      filmGlowModelV1Schema.safeParse({
        ...sampleFilmGlowModelV1,
        algorithm: 'legacy_rapidraw_glow_bloom_v0',
      }).success,
    ).toBe(false);
    expect(
      filmBlackAndWhiteModelV1Schema.safeParse({
        ...sampleFilmBlackAndWhiteModelV1,
        algorithm: 'legacy_rapidraw_desaturate_v0',
      }).success,
    ).toBe(false);
    expect(
      filmGrainModelV1Schema.safeParse({
        ...sampleFilmGrainModelV1,
        algorithm: 'legacy_rapidraw_luma_noise_v0',
      }).success,
    ).toBe(false);
  });

  test('keeps every governed current profile on the strict current node', () => {
    const catalog = getFilmBaselineProfileCatalog();
    const document = createDefaultEditDocumentV2();
    const filmEnvelope = document.nodes['film_emulation'];
    if (filmEnvelope === undefined) throw new Error('Expected Film sidecar node.');
    expect(catalog).toHaveLength(5);
    for (const profile of catalog) {
      expect(filmProfileManifestV1Schema.safeParse(profile).success).toBe(true);
      expect(profile.model.nodeType).toBe('film_emulation');
      expect(profile.model.seedPolicy).toBe('source_stable_v1');
      const profileEnvelope = {
        ...filmEnvelope,
        params: { filmEmulation: profile.model },
      };
      const sidecar = editDocumentV2Schema.parse({
        ...document,
        nodes: { ...document.nodes, film_emulation: profileEnvelope },
      });
      const reopened = editDocumentV2Schema.parse(JSON.parse(JSON.stringify(sidecar)));
      expect(reopened.nodes['film_emulation']?.params['filmEmulation']).toEqual(profile.model);
      expect(
        editDocumentV2CopyPayloadSchema.safeParse({
          nodes: { film_emulation: profileEnvelope },
          schemaVersion: 2,
        }).success,
      ).toBe(true);
    }
  });

  test('rejects old model identifiers at profile, sidecar, and preset boundaries', () => {
    const profile = getFilmBaselineProfileCatalog()[0];
    if (profile === undefined) throw new Error('Expected current Film profile.');
    const document = createDefaultEditDocumentV2();
    const filmEnvelope = document.nodes['film_emulation'];
    if (filmEnvelope === undefined) throw new Error('Expected Film sidecar node.');

    const corruptPresetItems = removedModelIds.map((algorithm) => {
      const corruptNode = { ...profile.model, algorithm };
      const corruptEnvelope = {
        ...filmEnvelope,
        params: { filmEmulation: corruptNode },
      };
      const corruptPayload = {
        nodes: { film_emulation: corruptEnvelope },
        schemaVersion: 2,
      };
      const corruptSidecar = {
        ...document,
        nodes: { ...document.nodes, film_emulation: corruptEnvelope },
      };
      const corruptProfile = { ...profile, model: corruptNode };

      expect(filmProfileManifestV1Schema.safeParse(corruptProfile).success).toBe(false);
      expect(editDocumentV2Schema.safeParse(corruptSidecar).success).toBe(false);
      expect(editDocumentV2CopyPayloadSchema.safeParse(corruptPayload).success).toBe(false);
      return {
        preset: {
          adjustments: {},
          editDocumentV2: corruptPayload,
          id: `removed-${algorithm}`,
          name: 'Removed Film model',
        },
      };
    });

    const parsedLibrary = parsePresetLibrary(corruptPresetItems);
    expect(parsedLibrary.items).toHaveLength(0);
    expect(parsedLibrary.quarantinedCount).toBe(removedModelIds.length);
  });
});
