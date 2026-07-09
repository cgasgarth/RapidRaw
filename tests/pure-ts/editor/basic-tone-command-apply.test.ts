import { beforeEach, describe, expect, test } from 'bun:test';

import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  applyBasicToneCommandToLiveEditor,
  dryRunBasicToneCommandInLiveEditor,
} from '../../../src/utils/agent/session/agentLiveBasicTone';
import {
  type BasicToneCommandEnvelope,
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
  type LegacyBasicToneAdjustmentPayload,
} from '../../../src/utils/basicToneCommandBridge';

const imagePath = '/fixtures/basic-tone-command-apply/DSC_4792.ARW';
const requestedAdjustments: LegacyBasicToneAdjustmentPayload = {
  blacks: -12,
  brightness: 0,
  clarity: 14,
  contrast: 22,
  exposure: 0.65,
  highlights: -31,
  saturation: 8,
  shadows: 19,
  whites: 27,
};

const seedEditor = () => {
  useEditorStore.setState({
    adjustments: INITIAL_ADJUSTMENTS,
    exportSoftProofTransform: {
      blackPointCompensation: 'enabled',
      colorManagedTransform: 'display-p3-preview',
      effectiveColorProfile: 'Display P3',
      effectiveRenderingIntent: 'relative_colorimetric',
      policyStatus: 'active',
      policyVersion: 'test-policy',
      sourcePrecisionPath: 'preview',
      transformApplied: true,
      transformPolicyFingerprint: 'fingerprint-before-basic-tone',
    },
    finalPreviewUrl: 'blob:basic-tone-before-final',
    gamutWarningOverlay: {
      activeProfile: 'Display P3',
      clippedPixelCount: 12,
      clippedPixelPercent: 0.4,
      generatedAt: '2026-07-02T12:00:00.000Z',
      imagePath,
      policyStatus: 'active',
      recipeId: 'recipe-before-basic-tone',
      renderingIntent: 'relative_colorimetric',
      transformFingerprint: 'fingerprint-before-basic-tone',
      warningCodes: [],
    },
    history: [INITIAL_ADJUSTMENTS],
    historyCheckpoints: [],
    historyIndex: 0,
    interactivePatch: {
      basePreviewUrl: 'blob:basic-tone-before',
      fullHeight: 400,
      fullWidth: 600,
      geometryIdentity: '{}',
      normH: 0.2,
      normW: 0.2,
      normX: 0.1,
      normY: 0.1,
      pixelHeight: 80,
      pixelWidth: 120,
      sourceImagePath: imagePath,
      url: 'blob:basic-tone-before-patch',
    },
    lastBasicToneCommand: null,
    previewScopeStatus: {
      displayTransformLabel: 'Display P3',
      exportProfileLabel: null,
      exportRenderingIntentLabel: null,
      histogramReady: true,
      path: imagePath,
      renderBasis: 'editor_preview',
      softProofTransformApplied: false,
      sourceLabel: 'Preview',
      updatedAt: '2026-07-02T12:00:00.000Z',
      waveformReady: true,
      workingTransformLabel: 'ACEScg',
      warningCodes: [],
    },
    selectedImage: {
      exif: { ISO: '200', LensModel: 'FE 35mm F1.4 GM' },
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:basic-tone-original',
      path: imagePath,
      thumbnailUrl: 'blob:basic-tone-thumb',
      width: 6000,
    },
    transformedOriginalUrl: 'blob:basic-tone-before-transformed',
    uncroppedAdjustedPreviewUrl: 'blob:basic-tone-before-uncropped',
  });
};

const buildCommand = (
  operationId: string,
  options: {
    acceptedDryRunPlanHash?: string;
    acceptedDryRunPlanId?: string;
    dryRun: boolean;
    expectedGraphRevision?: string;
  },
): BasicToneCommandEnvelope =>
  buildBasicToneCommandEnvelope(
    requestedAdjustments,
    buildBasicToneImageCommandContext({
      expectedGraphRevision: options.expectedGraphRevision ?? `history_${useEditorStore.getState().historyIndex}`,
      imagePath,
      operationId,
      sessionId: 'basic-tone-command-apply-test',
    }),
    options,
  );

describe('basic tone command apply path', () => {
  beforeEach(() => {
    seedEditor();
  });

  test('dry-run returns a parameter diff without mutating editor state', async () => {
    const before = useEditorStore.getState();
    const dryRun = await dryRunBasicToneCommandInLiveEditor(buildCommand('dry_run_only', { dryRun: true }));

    expect(dryRun.mutates).toBe(false);
    expect(dryRun.parameterDiff.some((diff) => diff.path === '/parameters/exposureEv')).toBe(true);

    const after = useEditorStore.getState();
    expect(after.adjustments).toBe(before.adjustments);
    expect(after.history).toEqual([INITIAL_ADJUSTMENTS]);
    expect(after.historyIndex).toBe(0);
    expect(after.lastBasicToneCommand).toBeNull();
    expect(after.uncroppedAdjustedPreviewUrl).toBe('blob:basic-tone-before-uncropped');
  });

  test('approved apply updates adjustments, records command, pushes history, and supports undo redo', async () => {
    const dryRun = await dryRunBasicToneCommandInLiveEditor(buildCommand('approved_apply', { dryRun: true }));
    const applyCommand = buildCommand('approved_apply', {
      acceptedDryRunPlanHash: dryRun.dryRunPlanHash,
      acceptedDryRunPlanId: dryRun.dryRunPlanId,
      dryRun: false,
    });

    const mutation = await applyBasicToneCommandToLiveEditor(applyCommand);

    expect(mutation.mutates).toBe(true);
    expect(mutation.commandId).toBe(applyCommand.commandId);

    const applied = useEditorStore.getState();
    expect(applied.adjustments.exposure).toBe(0.65);
    expect(applied.adjustments.highlights).toBe(-31);
    expect(applied.adjustments.whites).toBe(27);
    expect(applied.history).toHaveLength(2);
    expect(applied.historyIndex).toBe(1);
    expect(applied.history[1]).toEqual(applied.adjustments);
    expect(applied.lastBasicToneCommand?.commandId).toBe(applyCommand.commandId);
    expect(applied.finalPreviewUrl).toBeNull();
    expect(applied.uncroppedAdjustedPreviewUrl).toBeNull();
    expect(applied.interactivePatch).toBeNull();
    expect(applied.previewScopeStatus).toBeNull();

    applied.undo();
    const undone = useEditorStore.getState();
    expect(undone.adjustments).toEqual(INITIAL_ADJUSTMENTS);
    expect(undone.historyIndex).toBe(0);
    expect(undone.history).toHaveLength(2);
    expect(undone.finalPreviewUrl).toBeNull();

    undone.redo();
    const redone = useEditorStore.getState();
    expect(redone.adjustments.exposure).toBe(0.65);
    expect(redone.historyIndex).toBe(1);
    expect(redone.uncroppedAdjustedPreviewUrl).toBeNull();
  });

  test('rejects stale and unapproved apply envelopes before editor mutation', () => {
    const staleCommand = buildCommand('stale_apply', {
      acceptedDryRunPlanHash: 'sha256:basic-tone:stale',
      acceptedDryRunPlanId: 'dryrun_basic_tone_stale',
      dryRun: false,
      expectedGraphRevision: 'history_99',
    });
    expect(() => useEditorStore.getState().applyBasicToneCommand(staleCommand)).toThrow('stale graph revision');

    const unapprovedCommand: BasicToneCommandEnvelope = {
      ...buildCommand('unapproved_apply', {
        acceptedDryRunPlanHash: 'sha256:basic-tone:unapproved',
        acceptedDryRunPlanId: 'dryrun_basic_tone_unapproved',
        dryRun: false,
      }),
      approval: {
        approvalClass: 'preview_only',
        reason: 'Preview-only commands must not mutate the editor.',
        state: 'not_required',
      },
    };
    expect(() => useEditorStore.getState().applyBasicToneCommand(unapprovedCommand)).toThrow(
      'approved edit-apply approval',
    );

    const state = useEditorStore.getState();
    expect(state.adjustments).toEqual(INITIAL_ADJUSTMENTS);
    expect(state.history).toEqual([INITIAL_ADJUSTMENTS]);
    expect(state.lastBasicToneCommand).toBeNull();
  });
});
