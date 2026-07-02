import { beforeEach, describe, expect, test } from 'bun:test';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import {
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  renderAgentReadOnlyPreview,
} from '../../../src/utils/agent/context/agentReadOnlyAppServerTools';
import {
  AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME,
  AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME,
  applyAgentToneAdjustment,
  buildAgentToneAdjustmentPromptDraft,
  dryRunAgentToneAdjustment,
} from '../../../src/utils/agent/tools/agentToneAdjustmentTool';

const selectedPath = '/fixtures/agent-tone-adjustment/DSC_4799.ARW';

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    finalPreviewUrl: 'blob:agent-tone-adjustment-before',
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage: {
      exif: { ISO: '200', LensModel: 'FE 24-70mm F2.8 GM II' },
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:agent-tone-adjustment-original',
      path: selectedPath,
      thumbnailUrl: 'blob:agent-tone-adjustment-thumb',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
};

describe('agent live typed basic-tone adjustment', () => {
  beforeEach(() => {
    seedEditor();
  });

  test('routes a supported prompt through dry-run, apply, and preview refresh receipts', async () => {
    const snapshot = buildAgentImageContextSnapshot();
    const draft = buildAgentToneAdjustmentPromptDraft(
      'Brighten the RAW, add contrast, recover highlights, and lift shadows.',
      useEditorStore.getState().adjustments,
    );
    expect(draft.supported).toBe(true);
    if (!draft.supported) throw new Error('Expected a supported basic-tone prompt draft.');

    const dryRun = await dryRunAgentToneAdjustment({
      adjustments: draft.requestedAdjustments,
      expectedGraphRevision: snapshot.graphRevision,
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      operationId: 'issue_4799_typed_tone_dry_run',
      requestId: 'issue_4799_typed_tone_dry_run',
      sessionId: 'agent-live-typed-tone-adjustment-test',
    });

    expect(dryRun.toolName).toBe(AGENT_TONE_ADJUSTMENT_DRY_RUN_TOOL_NAME);
    expect(dryRun.receipt.dryRunPlanHash).toBe(dryRun.dryRunPlanHash);
    expect(dryRun.receipt.dryRunPlanId).toBe(dryRun.dryRunPlanId);
    expect(dryRun.receipt.previewAfter.artifactId).toBe(dryRun.previewAfter.artifactId);
    expect(dryRun.receipt.previewAfter.renderHash).toBe(dryRun.previewAfter.renderHash);
    expect(dryRun.receipt.sourceGraphRevision).toBe(snapshot.graphRevision);

    const apply = await applyAgentToneAdjustment({
      acceptedPlanHash: dryRun.dryRunPlanHash,
      acceptedPlanId: dryRun.dryRunPlanId,
      adjustments: draft.requestedAdjustments,
      expectedGraphRevision: dryRun.sourceGraphRevision,
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      operationId: 'issue_4799_typed_tone_dry_run',
      requestId: 'issue_4799_typed_tone_apply',
      sessionId: 'agent-live-typed-tone-adjustment-test',
    });

    expect(apply.toolName).toBe(AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME);
    expect(apply.receipt.acceptedPlanHash).toBe(dryRun.dryRunPlanHash);
    expect(apply.receipt.acceptedPlanId).toBe(dryRun.dryRunPlanId);
    expect(apply.receipt.afterPreviewHash).toBe(apply.afterPreviewHash);
    expect(useEditorStore.getState().historyIndex).toBe(1);

    const afterSnapshot = buildAgentImageContextSnapshot();
    const previewRefresh = renderAgentReadOnlyPreview({
      expectedRecipeHash: afterSnapshot.initialPreview.recipeHash,
      purpose: 'refresh',
      requestId: 'issue_4799_typed_tone_refresh',
      sourceToolName: AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME,
      turn: useEditorStore.getState().historyIndex,
    });

    expect(previewRefresh.toolName).toBe(AGENT_PREVIEW_RENDER_TOOL_NAME);
    expect(previewRefresh.receipt?.toolName).toBe(AGENT_PREVIEW_RENDER_TOOL_NAME);
    expect(previewRefresh.receipt?.proofContext.sourceToolName).toBe(AGENT_TONE_ADJUSTMENT_APPLY_TOOL_NAME);
    expect(previewRefresh.receipt?.proofContext.stale).toBe(false);
    expect(previewRefresh.receipt?.preview.artifactId).toBe(previewRefresh.preview.artifactId);
    expect(previewRefresh.receipt?.preview.renderHash).toBe(previewRefresh.preview.renderHash);
    expect(previewRefresh.receipt?.contentHash).toMatch(/^sha256:[a-f0-9]{16,64}$/u);
  });

  test('rejects unsupported live chat prompts without mutating editor state', () => {
    const before = useEditorStore.getState();
    const draft = buildAgentToneAdjustmentPromptDraft(
      'Remove the telephone pole from the background.',
      before.adjustments,
    );

    expect(draft.supported).toBe(false);
    if (draft.supported) throw new Error('Expected an unsupported prompt draft.');
    expect(draft.reason).toContain('Only basic tone prompts');
    expect(useEditorStore.getState().historyIndex).toBe(0);
    expect(useEditorStore.getState().adjustments).toEqual(before.adjustments);
  });
});
