import { describe, expect, test } from 'bun:test';

import type { NegativeLabFrameRgbBalanceOffset } from '../../../src/schemas/negative-lab/negativeLabFrameRgbBalanceOverrideSchemas.ts';
import { EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD } from '../../../src/utils/negative-lab/negativeLabPatchSamplerCorrections.ts';
import {
  buildNegativeLabAcceptedApplyPlanFingerprint,
  getNegativeLabAcceptedApplyPlanStaleReasons,
  isNegativeLabAcceptedApplyPlanCurrent,
} from '../../../src/utils/negative-lab/negativeLabPlanIdentity.ts';
import { DEFAULT_NEGATIVE_LAB_UI_PRESET } from '../../../src/utils/negative-lab/negativeLabPresetCatalog.ts';
import {
  acceptNegativeLabSessionPlan,
  buildNegativeLabSessionFrameViewState,
  createNegativeLabSessionState,
  reconcileNegativeLabSessionTargetPaths,
  setNegativeLabSessionActiveFrame,
  setNegativeLabSessionBatchApplyReceipt,
  setNegativeLabSessionFrameExposureOffset,
  setNegativeLabSessionFrameRgbBalanceOffset,
  setNegativeLabSessionRollNormalizationApplyReceipt,
  setNegativeLabSessionRollNormalizationRestoreReceipt,
} from '../../../src/utils/negative-lab/negativeLabSessionState.ts';

const defaultRecipeState = {
  conversionScope: 'all',
  openSavedPositiveInEditor: true,
  params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
  patchSamplerCorrectionPayload: EMPTY_NEGATIVE_LAB_PATCH_SAMPLER_CORRECTION_PAYLOAD,
  saveOptions: {
    outputFormat: 'tiff16',
    suffix: 'Positive',
    writeConversionBundle: true,
  },
  selectedAcquisitionProfileId: 'camera_raw_linear_v1',
  selectedPresetId: DEFAULT_NEGATIVE_LAB_UI_PRESET.presetId,
} as const;

const buildSession = (targetPaths: readonly string[]) =>
  createNegativeLabSessionState(targetPaths, {
    recipeState: defaultRecipeState,
    sessionId: 'negative_lab_session_test',
  });

describe('negative lab session state', () => {
  test('reconciles added and removed frames while preserving per-path overrides', () => {
    let snapshot = buildSession(['/roll/frame-001.tif', '/roll/frame-002.tif']);
    snapshot = setNegativeLabSessionFrameExposureOffset(snapshot, 'negative-lab-frame-2', 0.15);

    snapshot = reconcileNegativeLabSessionTargetPaths(snapshot, [
      '/roll/frame-001.tif',
      '/roll/frame-002.tif',
      '/roll/frame-003.tif',
    ]);
    expect(snapshot.session.targetPaths).toEqual(['/roll/frame-001.tif', '/roll/frame-002.tif', '/roll/frame-003.tif']);

    snapshot = reconcileNegativeLabSessionTargetPaths(snapshot, ['/roll/frame-002.tif', '/roll/frame-003.tif']);
    const frameViewState = buildNegativeLabSessionFrameViewState(snapshot);

    expect(snapshot.session.targetPaths).toEqual(['/roll/frame-002.tif', '/roll/frame-003.tif']);
    expect(frameViewState.frameExposureOffsetByFrameId).toEqual({ 'negative-lab-frame-1': 0.15 });
  });

  test('switches the active frame through the derived frame id graph', () => {
    const snapshot = setNegativeLabSessionActiveFrame(
      buildSession(['/roll/frame-001.tif', '/roll/frame-002.tif', '/roll/frame-003.tif']),
      'negative-lab-frame-3',
    );

    expect(snapshot.session.activePath).toBe('/roll/frame-003.tif');
    expect(buildNegativeLabSessionFrameViewState(snapshot).activePathIndex).toBe(2);
    expect(snapshot.session.sessionRevision).toBe(1);
  });

  test('updates per-frame exposure and RGB balance overrides in the current frame graph', () => {
    const rgbBalanceOffset: NegativeLabFrameRgbBalanceOffset = {
      blueWeight: -0.04,
      greenWeight: 0.02,
      redWeight: 0.08,
    };
    let snapshot = buildSession(['/roll/frame-001.tif', '/roll/frame-002.tif']);
    snapshot = setNegativeLabSessionFrameExposureOffset(snapshot, 'negative-lab-frame-2', -0.1);
    snapshot = setNegativeLabSessionFrameRgbBalanceOffset(snapshot, 'negative-lab-frame-2', rgbBalanceOffset);

    const frameViewState = buildNegativeLabSessionFrameViewState(snapshot);
    expect(frameViewState.frameExposureOffsetByFrameId).toEqual({ 'negative-lab-frame-2': -0.1 });
    expect(frameViewState.frameRgbBalanceOffsetByFrameId).toEqual({ 'negative-lab-frame-2': rgbBalanceOffset });
    expect(snapshot.session.sessionRevision).toBe(2);
  });

  test('inserts proof receipts without mutating the recipe session revision', () => {
    const initialSnapshot = acceptNegativeLabSessionPlan(
      buildSession(['/roll/frame-001.tif', '/roll/frame-002.tif']),
      'accepted-plan-fingerprint',
    );
    const sessionRevisionBeforeProof = initialSnapshot.session.sessionRevision;
    const snapshotWithReceipts = setNegativeLabSessionRollNormalizationRestoreReceipt(
      setNegativeLabSessionRollNormalizationApplyReceipt(
        setNegativeLabSessionBatchApplyReceipt(initialSnapshot, {
          acceptedDryRunPlanHash: 'fnv1a32:abcdef12',
          acceptedDryRunPlanId: 'negative_lab_batch_plan_abcdef12',
          acquisitionReviewFrameIds: [],
          appliedPositiveCount: 1,
          appliedPositives: [],
          contactSheetArtifactId: 'artifact_qc_sheet',
          editorHandoff: {
            activePositivePath: null,
            openInEditor: true,
            savedPathCount: 0,
          },
          generatedAt: '2026-07-06T00:00:00.000Z',
          generatedProofId: 'proof_negative_lab_qc',
          plannedApplyCount: 1,
          proofWarningCount: 0,
          queuedFrameCount: 2,
          reviewFrameCount: 0,
          rollWarningCodes: [],
          savedPaths: [],
          savedPositiveVariantIds: [],
          skippedFrameCount: 0,
        }),
        {
          acceptedDryRunPlanHash: 'fnv1a32:abcdef12',
          acceptedDryRunPlanId: 'negative_lab_batch_plan_abcdef12',
          appliedFrameCount: 1,
          exposureOverrideCount: 1,
          manualExposurePreservedFrameIds: [],
          manualRgbPreservedFrameIds: [],
          previousFrameExposureOffsetByFrameId: {},
          previousFrameRgbBalanceOffsetByFrameId: {},
          restored: false,
          restoreRevision: 1,
          reviewFrameCount: 0,
          rgbBalanceOverrideCount: 0,
          skippedFrameCount: 0,
        },
      ),
      {
        acceptedDryRunPlanHash: 'fnv1a32:abcdef12',
        acceptedDryRunPlanId: 'negative_lab_batch_plan_abcdef12',
        restoredExposureOverrideCount: 0,
        restoredFrameCount: 0,
        restoredRevision: 1,
        restoredRgbBalanceOverrideCount: 0,
      },
    );

    expect(snapshotWithReceipts.proofState.batchApplyReceipt?.generatedProofId).toBe('proof_negative_lab_qc');
    expect(snapshotWithReceipts.proofState.rollNormalizationApplyReceipt?.restoreRevision).toBe(1);
    expect(snapshotWithReceipts.proofState.rollNormalizationRestoreReceipt?.restoredRevision).toBe(1);
    expect(snapshotWithReceipts.session.sessionRevision).toBe(sessionRevisionBeforeProof);
  });

  test('invalidates accepted plans from the session revision instead of clearing them', () => {
    const acceptedSnapshot = acceptNegativeLabSessionPlan(
      buildSession(['/roll/frame-001.tif', '/roll/frame-002.tif']),
      buildNegativeLabAcceptedApplyPlanFingerprint({
        dryRunPlanJson: JSON.stringify({ plan: 'negative_lab_batch_plan' }),
        outputFormat: 'tiff16',
        params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
        pathsToConvert: ['/roll/frame-001.tif', '/roll/frame-002.tif'],
        selectedProfileSnapshot: null,
        sessionRevision: 0,
        suffix: 'Positive',
        writeConversionBundle: true,
      }),
    );
    const mutatedSnapshot = setNegativeLabSessionFrameExposureOffset(acceptedSnapshot, 'negative-lab-frame-2', 0.2);
    const currentFingerprint = buildNegativeLabAcceptedApplyPlanFingerprint({
      dryRunPlanJson: JSON.stringify({ plan: 'negative_lab_batch_plan' }),
      outputFormat: 'tiff16',
      params: DEFAULT_NEGATIVE_LAB_UI_PRESET.params,
      pathsToConvert: ['/roll/frame-001.tif', '/roll/frame-002.tif'],
      selectedProfileSnapshot: null,
      sessionRevision: mutatedSnapshot.session.sessionRevision,
      suffix: 'Positive',
      writeConversionBundle: true,
    });

    expect(
      isNegativeLabAcceptedApplyPlanCurrent({
        acceptedApplyPlanFingerprint: acceptedSnapshot.planState.acceptedApplyPlanFingerprint,
        currentApplyPlanFingerprint: currentFingerprint,
      }),
    ).toBe(false);
    expect(
      getNegativeLabAcceptedApplyPlanStaleReasons({
        acceptedApplyPlanFingerprint: acceptedSnapshot.planState.acceptedApplyPlanFingerprint,
        currentApplyPlanFingerprint: currentFingerprint,
      }),
    ).toEqual(['session_revision_changed']);
  });
});
