import { beforeEach, describe, expect, test } from 'bun:test';

import {
  rawEngineAgentInitialPreviewReceiptV1Schema,
  rawEngineAgentPreviewRefreshReceiptV1Schema,
} from '../../../packages/rawengine-schema/src/localAppServerBridge';
import { rawEngineDefaultToolRegistryV1 } from '../../../packages/rawengine-schema/src/toolRegistry';
import { ToolType } from '../../../src/components/panel/right/layers/Masks';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  getRawEngineImagePreview,
  RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
  renderAgentReadOnlyPreview,
} from '../../../src/utils/agent/context/agentReadOnlyAppServerTools';

const selectedPath = '/fixtures/agent-preview-receipts/DSC_4749.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 6 : 3));

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
    finalPreviewUrl: 'blob:rawengine-agent-preview-receipts-current',
    hasRenderedFirstFrame: true,
    histogram: {
      [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
      [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
      [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
      [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
    },
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage: {
      exif: { ISO: '320', LensModel: 'FE 24-70mm F2.8 GM II' },
      height: 4024,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:rawengine-agent-preview-receipts-original',
      path: selectedPath,
      thumbnailUrl: 'blob:rawengine-agent-preview-receipts-thumb',
      width: 6048,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
};

describe('agent selected-image preview receipts', () => {
  beforeEach(() => {
    seedEditor();
  });

  test('observes selected-image preview with a schema-compliant local-private receipt', () => {
    const observed = getRawEngineImagePreview({ requestId: 'issue-4749-observe' });
    const receipt = rawEngineAgentInitialPreviewReceiptV1Schema.parse(observed.receipt);

    expect(receipt.toolName).toBe(RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME);
    expect(receipt.imagePath).toBe(selectedPath);
    expect(receipt.preview.previewRef).toBe('blob:rawengine-agent-preview-receipts-current');
    expect(receipt.preview.includesOriginalRaw).toBe(false);
    expect(receipt.preview.accessScope).toBe('local_private');
    expect(receipt.preview.longEdgePx).toBe(1536);
    expect(receipt.preview.width).toBe(observed.dimensions.width);
    expect(receipt.preview.height).toBe(observed.dimensions.height);
    expect(receipt.graphRevision).toBe(observed.editRevision.graphRevision);
    expect(receipt.preview.recipeHash).toBe(observed.editRevision.recipeHash);
    expect(receipt.preview.renderHash).toBe(observed.editRevision.renderHash);
    expect(receipt.contentHash).toMatch(/^sha256:[a-f0-9]{16,64}$/u);
  });

  test('renders refresh previews with receipt identity and stale proof context', () => {
    const observed = getRawEngineImagePreview({ requestId: 'issue-4749-observe-before-refresh' });
    const refresh = renderAgentReadOnlyPreview({
      expectedRecipeHash: observed.receipt.preview.recipeHash,
      purpose: 'refresh',
      requestId: 'issue-4749-refresh',
      sourceToolName: 'rawengine.agent.adjustments.apply',
      turn: 2,
    });
    const receipt = rawEngineAgentPreviewRefreshReceiptV1Schema.parse(refresh.receipt);

    expect(receipt.toolName).toBe(AGENT_PREVIEW_RENDER_TOOL_NAME);
    expect(receipt.imagePath).toBe(selectedPath);
    expect(receipt.turn).toBe(2);
    expect(receipt.proofContext.sourceToolName).toBe('rawengine.agent.adjustments.apply');
    expect(receipt.proofContext.stale).toBe(false);
    expect(receipt.preview.artifactId).toBe(refresh.preview.artifactId);
    expect(receipt.preview.renderHash).toBe(refresh.preview.renderHash);
    expect(receipt.contentHash).toMatch(/^sha256:[a-f0-9]{16,64}$/u);

    const staleRefresh = renderAgentReadOnlyPreview({
      expectedRecipeHash: 'recipe:stale',
      purpose: 'detail_review',
      requestId: 'issue-4749-stale-refresh',
      turn: 3,
    });
    expect(staleRefresh.receipt?.proofContext.stale).toBe(true);
  });

  test('rejects stale or mismatched preview receipt identities', () => {
    const refresh = renderAgentReadOnlyPreview({
      purpose: 'refresh',
      requestId: 'issue-4749-refresh-reject',
      turn: 1,
    });
    const receipt = rawEngineAgentPreviewRefreshReceiptV1Schema.parse(refresh.receipt);

    expect(() =>
      rawEngineAgentPreviewRefreshReceiptV1Schema.parse({
        ...receipt,
        proofContext: {
          ...receipt.proofContext,
          expectedRecipeHash: 'recipe:stale',
        },
      }),
    ).toThrow('expected recipe hash');

    expect(receipt.contentHash === `sha256:${receipt.preview.renderHash}`).toBe(false);
  });

  test('registers observe and refresh preview tools as safe read artifact-handle tools', () => {
    for (const toolName of [RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME, AGENT_PREVIEW_RENDER_TOOL_NAME]) {
      const entry = rawEngineDefaultToolRegistryV1.tools.find((tool) => tool.toolName === toolName);
      expect(entry).toBeDefined();
      expect(entry?.approvalClass).toBe('safe_read');
      expect(entry?.mutates).toBe(false);
      expect(entry?.requiresDryRun).toBe(false);
      expect(entry?.returnsArtifactHandles).toBe(true);
      expect(entry?.toolKind).toBe('read');
    }
  });
});
