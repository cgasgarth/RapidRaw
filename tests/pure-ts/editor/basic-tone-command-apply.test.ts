import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
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
import { captureBasicToneCommitIdentity } from '../../../src/utils/basicToneEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

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
  const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
  const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
    adjustments,
    editDocumentV2,
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
    history: [adjustments],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: createEditorImageSession({ generation: 23, path: imagePath, source: 'cache' }),
    imageSessionId: 23,
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
    lastEditApplicationReceipt: null,
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
    expect(applied.adjustmentRevision).toBe(1);
    expect(applied.lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      baseAdjustmentRevision: 0,
      changedKeys: expect.arrayContaining(['exposure', 'highlights', 'whites']),
      persistence: 'commit',
      source: 'agent-command',
      transactionId: applyCommand.commandId,
    });
    expect(applied.editDocumentV2.nodes.scene_global_color_tone?.params).toMatchObject({
      exposure: 0.65,
      highlights: -31,
      whites: 27,
    });
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
    const identity = captureBasicToneCommitIdentity(useEditorStore.getState());
    if (identity === null) throw new Error('Expected seeded basic-tone identity.');
    expect(() => useEditorStore.getState().applyBasicToneCommand(staleCommand, identity)).toThrow(
      'stale graph revision',
    );

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
    expect(() => useEditorStore.getState().applyBasicToneCommand(unapprovedCommand, identity)).toThrow(
      'approved edit-apply approval',
    );

    const state = useEditorStore.getState();
    expect(state.adjustments).toEqual(INITIAL_ADJUSTMENTS);
    expect(state.history).toEqual([INITIAL_ADJUSTMENTS]);
    expect(state.lastBasicToneCommand).toBeNull();
  });

  test('preserves exact command no-ops without history, persistence, or derived-pixel invalidation', () => {
    const state = useEditorStore.getState();
    const identity = captureBasicToneCommitIdentity(state);
    if (identity === null) throw new Error('Expected seeded basic-tone identity.');
    const command = buildBasicToneCommandEnvelope(
      INITIAL_ADJUSTMENTS,
      buildBasicToneImageCommandContext({
        expectedGraphRevision: 'history_0',
        imagePath,
        operationId: 'exact_no_op',
        sessionId: 'basic-tone-command-apply-test',
      }),
      {
        acceptedDryRunPlanHash: 'sha256:basic-tone:no-op',
        acceptedDryRunPlanId: 'dryrun_basic_tone_no_op',
        dryRun: false,
      },
    );

    const result = state.applyBasicToneCommand(command, identity);
    const after = useEditorStore.getState();
    expect(result.noOp).toBe(true);
    expect(after.adjustmentRevision).toBe(0);
    expect(after.history).toHaveLength(1);
    expect(after.lastEditApplicationReceipt).toBeNull();
    expect(after.lastBasicToneCommand?.commandId).toBe(command.commandId);
    expect(after.finalPreviewUrl).toBe('blob:basic-tone-before-final');
    expect(after.uncroppedAdjustedPreviewUrl).toBe('blob:basic-tone-before-uncropped');
  });

  test('rejects a delayed command after source, session, or revision authority changes', () => {
    commitInterveningExposure(0.1);
    const identity = captureBasicToneCommitIdentity(useEditorStore.getState());
    if (identity === null) throw new Error('Expected seeded basic-tone identity.');
    const command = buildCommand('delayed_apply', {
      acceptedDryRunPlanHash: 'sha256:basic-tone:delayed',
      acceptedDryRunPlanId: 'dryrun_basic_tone_delayed',
      dryRun: false,
    });

    commitInterveningExposure(0.2);
    expect(() => useEditorStore.getState().applyBasicToneCommand(command, identity)).toThrow(
      'basic_tone_transaction.stale_revision:1:2',
    );

    seedEditor();
    const sourceIdentity = captureBasicToneCommitIdentity(useEditorStore.getState());
    if (sourceIdentity === null) throw new Error('Expected seeded basic-tone identity.');
    const sourceCommand = buildCommand('source_changed_apply', {
      acceptedDryRunPlanHash: 'sha256:basic-tone:source',
      acceptedDryRunPlanId: 'dryrun_basic_tone_source',
      dryRun: false,
    });
    const selectedImage = useEditorStore.getState().selectedImage;
    if (selectedImage === null) throw new Error('Expected seeded selected image.');
    useEditorStore.setState({
      imageSession: createEditorImageSession({ generation: 24, path: '/fixtures/other.ARW', source: 'cache' }),
      selectedImage: { ...selectedImage, path: '/fixtures/other.ARW' },
    });
    expect(() => useEditorStore.getState().applyBasicToneCommand(sourceCommand, sourceIdentity)).toThrow(
      `basic_tone_transaction.stale_source:${imagePath}:/fixtures/other.ARW`,
    );

    seedEditor();
    const sessionIdentity = captureBasicToneCommitIdentity(useEditorStore.getState());
    if (sessionIdentity === null) throw new Error('Expected seeded basic-tone identity.');
    useEditorStore.setState({
      imageSession: createEditorImageSession({ generation: 25, path: imagePath, source: 'cache' }),
    });
    expect(() => useEditorStore.getState().applyBasicToneCommand(sourceCommand, sessionIdentity)).toThrow(
      `basic_tone_transaction.stale_session:${sessionIdentity.imageSessionId}:editor-image-session:25:${String(imagePath.length)}:${imagePath}`,
    );
  });
});

const commitInterveningExposure = (exposure: number) => {
  const state = useEditorStore.getState();
  state.applyEditTransaction({
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'coalesced-interaction',
    imageSessionId: state.imageSession?.id ?? '',
    operations: [{ patch: { exposure }, type: 'patch-adjustments' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId: 'intervening-coalesced-edit',
  });
};
