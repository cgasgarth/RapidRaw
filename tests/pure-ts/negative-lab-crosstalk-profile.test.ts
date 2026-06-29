import { describe, expect, test } from 'bun:test';

import { negativeLabRuntimeProfileBrowserRowSchema } from '../../src/schemas/negativeLabMeasuredProfileSchemas.ts';
import {
  NEGATIVE_LAB_IDENTITY_CROSSTALK_PROFILE,
  applyNegativeLabDensityCrosstalk,
  buildNegativeLabCrosstalkProfile,
  buildNegativeLabCrosstalkProfileProvenanceHash,
  normalizeNegativeLabCrosstalkMatrixRows,
} from '../../src/utils/negativeLabCrosstalkProfile.ts';
import {
  buildNegativeLabRuntimeProfileProvenanceHash,
  resolveNegativeLabRuntimeProfile,
} from '../../src/utils/negativeLabMeasuredProfileRuntime.ts';

describe('negative lab density crosstalk profiles', () => {
  test('keeps the RawEngine identity profile as a no-op', () => {
    const sample: [number, number, number] = [0.12, 0.34, 0.56];

    expect(applyNegativeLabDensityCrosstalk(sample, NEGATIVE_LAB_IDENTITY_CROSSTALK_PROFILE)).toEqual(sample);
    expect(NEGATIVE_LAB_IDENTITY_CROSSTALK_PROFILE.provenance).toBe('rawengine_identity_default');
  });

  test('normalizes rows and preserves gray density values', () => {
    const profile = buildNegativeLabCrosstalkProfile({
      matrix: [
        [2, 1, 1],
        [1, 2, 1],
        [1, 1, 2],
      ],
      profileId: 'negative_lab.crosstalk.user.gray_preserving.v1',
      provenance: 'user_owned',
      schemaVersion: 1,
      strength: 0.75,
    });
    const gray = applyNegativeLabDensityCrosstalk([0.42, 0.42, 0.42], profile);

    expect(normalizeNegativeLabCrosstalkMatrixRows(profile.matrix)[0]).toEqual([0.5, 0.25, 0.25]);
    expect(gray[0]).toBeCloseTo(0.42, 12);
    expect(gray[1]).toBeCloseTo(0.42, 12);
    expect(gray[2]).toBeCloseTo(0.42, 12);
  });

  test('rejects malformed, non-finite, and non-normalizable profiles', () => {
    expect(() =>
      buildNegativeLabCrosstalkProfile({
        matrix: [
          [1, 0, 0],
          [0, Number.POSITIVE_INFINITY, 0],
          [0, 0, 1],
        ],
        profileId: 'negative_lab.crosstalk.user.bad_finite.v1',
        provenance: 'user_owned',
        schemaVersion: 1,
        strength: 0.5,
      }),
    ).toThrow();

    expect(() =>
      buildNegativeLabCrosstalkProfile({
        matrix: [
          [1, 0, 0],
          [0, 0, 0],
          [0, 0, 1],
        ],
        profileId: 'negative_lab.crosstalk.user.bad_row.v1',
        provenance: 'user_owned',
        schemaVersion: 1,
        strength: 0.5,
      }),
    ).toThrow();

    expect(() =>
      buildNegativeLabCrosstalkProfile({
        matrix: [
          [1, 0, 0],
          [0, 1, 0],
        ] as never,
        profileId: 'negative_lab.crosstalk.user.bad_shape.v1',
        provenance: 'user_owned',
        schemaVersion: 1,
        strength: 0.5,
      }),
    ).toThrow();
  });

  test('records crosstalk provenance in the runtime profile hash', () => {
    const userProfile = resolveNegativeLabRuntimeProfile('negative_lab.user.c41.local_warm_proof.v1');
    const identityProfile = resolveNegativeLabRuntimeProfile('negative_lab.generic.c41.neutral.v1');
    const crosstalkProfile = userProfile.crosstalkProfile;
    if (crosstalkProfile === null) throw new Error('User profile crosstalk profile is missing.');
    const { provenanceHash: _provenanceHash, ...crosstalkPayload } = crosstalkProfile;

    expect(crosstalkProfile.provenance).toBe('user_owned');
    expect(crosstalkProfile.provenanceHash).toBe(buildNegativeLabCrosstalkProfileProvenanceHash(crosstalkPayload));
    expect(buildNegativeLabRuntimeProfileProvenanceHash(userProfile)).not.toBe(
      buildNegativeLabRuntimeProfileProvenanceHash(identityProfile),
    );
  });

  test('suppresses crosstalk controls for black-and-white profiles', () => {
    const bwProfile = resolveNegativeLabRuntimeProfile('negative_lab.generic.bw.classic.v1');

    expect(bwProfile.crosstalkProfile).toBeNull();
    expect(() =>
      negativeLabRuntimeProfileBrowserRowSchema.parse({
        claimLevel: 'user_profile',
        claimPolicy: 'user_profile_no_stock_claim',
        crosstalkProfile: NEGATIVE_LAB_IDENTITY_CROSSTALK_PROFILE,
        disabledReason: null,
        displayName: 'User profile: B&W hidden crosstalk',
        doesNotProve: ['user_profile_unmeasured', 'no_stock_emulation_claim', 'no_colorimetric_match_claim'],
        evidenceFixtureCount: 0,
        filmClass: 'black_and_white_silver',
        isSelectable: true,
        measurementProfileId: 'negative_lab.user.bw.hidden_crosstalk.v1',
        params: {
          base_fog_sample: null,
          base_fog_strength: 1,
          blue_weight: 1,
          contrast: 1,
          exposure: 0,
          green_weight: 1,
          red_weight: 1,
        },
        presetId: 'negative_lab.user.bw.hidden_crosstalk.v1',
        processFamily: 'black_and_white_silver_negative',
        profileStatus: 'user_supplied',
        provenanceSummary: 'User-owned local B&W profile; crosstalk must stay hidden.',
        runtimeStatus: 'runtime_parameter_applied',
        sourceGenericPresetId: 'negative_lab.generic.bw.classic.v1',
      }),
    ).toThrow();
  });
});
