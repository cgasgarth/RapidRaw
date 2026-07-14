import { describe, expect, test } from 'bun:test';

import { negativeLabProfileFitReceiptSchema } from '../../../src/schemas/negative-lab/negativeLabMeasuredProfileSchemas';
import { buildNegativeLabMeasuredProfileFromFit } from '../../../src/utils/negative-lab/negativeLabMeasuredProfileFit';
import { NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG } from '../../../src/utils/negative-lab/negativeLabMeasuredProfileRuntime';

const hash = (_value: string) => `sha256:${'a'.repeat(64)}`;

describe('Negative Lab measured profile fit builder', () => {
  test('builds a runtime-applied profile from a gated native receipt', () => {
    const receipt = negativeLabProfileFitReceiptSchema.parse({
      algorithmId: 'native_negative_lab_profile_fit_v1',
      claimStatus: 'runtime_parameter_applied',
      confidence: 0.88,
      crosstalkStatus: 'identity_crosstalk_pending_conditioning',
      fittedParams: { baseFogStrength: 1.02, blueWeight: 1.15, contrast: 1.08, greenWeight: 0.94, redWeight: 1.1 },
      maxResidual: 0.09,
      reportHash: hash('r'),
      rejectedPatchCount: 0,
      residualMean: 0.04,
      schemaVersion: 1,
      sourceInterpretationHash: hash('s'),
      targetLayoutId: 'rawengine_negative_lab_target_v1',
      usedPatchCount: 24,
      warningCodes: ['no_stock_emulation_claim', 'no_colorimetric_match_claim'],
    });
    const baseline = NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG.genericCatalog.presets[0];
    if (baseline === undefined) throw new Error('Expected generic Negative Lab baseline.');
    const profile = buildNegativeLabMeasuredProfileFromFit({
      baseParams: baseline.params,
      displayName: 'Measured local target',
      evidenceFixtureIds: ['target-capture-001'],
      evidenceFixtureHashes: [hash('f')],
      profileId: 'negative_lab.measured.c41.local_target.v1',
      receipt,
      sourceGenericPresetId: baseline.presetId,
    });
    expect(profile.runtimeStatus).toBe('runtime_parameter_applied');
    expect(profile.params.red_weight).toBeCloseTo(1.1);
    expect(profile.doesNotProve).toContain('no_stock_emulation_claim');
  });

  test('keeps blocked fits non-runtime and claim-limited', () => {
    const receipt = negativeLabProfileFitReceiptSchema.parse({
      algorithmId: 'native_negative_lab_profile_fit_v1',
      claimStatus: 'blocked_or_unsupported',
      confidence: 0.3,
      crosstalkStatus: 'identity_not_measured',
      fittedParams: { baseFogStrength: 1, blueWeight: 1, contrast: 1, greenWeight: 1, redWeight: 1 },
      maxResidual: 0.4,
      reportHash: hash('r'),
      rejectedPatchCount: 3,
      residualMean: 0.25,
      schemaVersion: 1,
      sourceInterpretationHash: hash('s'),
      targetLayoutId: 'rawengine_negative_lab_target_v1',
      usedPatchCount: 12,
      warningCodes: ['fit_confidence_below_runtime_threshold'],
    });
    const baseline = NEGATIVE_LAB_RUNTIME_PROFILE_CATALOG.genericCatalog.presets[0];
    if (baseline === undefined) throw new Error('Expected generic Negative Lab baseline.');
    const profile = buildNegativeLabMeasuredProfileFromFit({
      baseParams: baseline.params,
      displayName: 'Blocked target fit',
      evidenceFixtureIds: ['target-capture-001'],
      evidenceFixtureHashes: [hash('f')],
      profileId: 'negative_lab.measured.c41.blocked_target.v1',
      receipt,
      sourceGenericPresetId: baseline.presetId,
    });
    expect(profile.runtimeStatus).toBe('ui_catalog_only');
    expect(profile.doesNotProve).toContain('schema_only');
  });
});
