import { beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agent/context/agentImageContextSnapshot';
import {
  AGENT_MEDIUM_PREVIEW_MAX_BYTES,
  type AgentMediumPreviewAttachmentError,
  AgentMediumPreviewAttachmentManager,
  decodeAgentJpegDimensions,
  sha256ForAgentPreviewBytes,
} from '../../../src/utils/agent/context/agentMediumPreviewAttachmentRuntime';

const fixturePath = new URL('../../fixtures/agent/agent-medium-preview-1536.jpg', import.meta.url);
const selectedPath = '/fixtures/agent-medium-preview-attachment/DSC_5015.ARW';

const seedEditor = () => {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    finalPreviewUrl: 'blob:agent-medium-preview-attachment',
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage: {
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: 'blob:agent-medium-preview-original',
      path: selectedPath,
      thumbnailUrl: 'blob:agent-medium-preview-thumbnail',
      width: 6000,
    },
    uncroppedAdjustedPreviewUrl: null,
  });
};

const loadFixture = async (): Promise<Uint8Array> => new Uint8Array(await readFile(fixturePath));

describe('agent medium preview attachment runtime', () => {
  beforeEach(() => {
    seedEditor();
  });

  test('uses a decodable JPEG and its true SHA-256 bytes identity', async () => {
    const bytes = await loadFixture();

    expect(decodeAgentJpegDimensions(bytes)).toEqual({ height: 1024, width: 1536 });
    expect(await sha256ForAgentPreviewBytes(bytes)).toBe(
      'sha256:576ec1492e64c850f4646503a83c403c41379aca3760cc69b50f2266d4ef643d',
    );
  });

  test('deduplicates one revision-bound attachment and redacts private source identity from the receipt', async () => {
    const bytes = await loadFixture();
    let renderCount = 0;
    const manager = new AgentMediumPreviewAttachmentManager(async () => {
      renderCount += 1;
      return new Uint8Array(bytes);
    });
    const snapshot = buildAgentImageContextSnapshot();
    const deadlineAt = Date.now() + 5_000;
    const [first, second] = await Promise.all([
      manager.acquire({ deadlineAt, snapshot }),
      manager.acquire({ deadlineAt, snapshot }),
    ]);

    expect(renderCount).toBe(1);
    expect(first.attachment.artifactId).toBe(second.attachment.artifactId);
    expect(first.attachment.contentHash).toBe(
      'sha256:576ec1492e64c850f4646503a83c403c41379aca3760cc69b50f2266d4ef643d',
    );
    expect(first.attachment.revision).toMatchObject({
      graphRevision: snapshot.graphRevision,
      recipeHash: snapshot.initialPreview.recipeHash,
      renderHash: snapshot.initialPreview.renderHash,
    });
    expect(first.attachment.dimensions).toEqual({ height: 1024, width: 1536 });
    expect(first.attachment.byteLength).toBe(bytes.byteLength);
    expect(first.attachment.includesOriginalRaw).toBe(false);
    expect(JSON.stringify(first.attachment)).not.toContain(selectedPath);

    manager.release(first.attachment.artifactId);
    expect(manager.getAuditAttachment(first.attachment.artifactId)?.lifecycle.status).toBe('released');
  });

  test('fails closed on revision drift, timeout, and oversized bytes without changing the editor', async () => {
    const bytes = await loadFixture();
    let resolveRender: ((value: Uint8Array) => void) | undefined;
    const manager = new AgentMediumPreviewAttachmentManager(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveRender = resolve;
        }),
    );
    const initialHistory = useEditorStore.getState().history;
    const snapshot = buildAgentImageContextSnapshot();
    const stale = manager.acquire({ deadlineAt: Date.now() + 5_000, snapshot });
    useEditorStore.setState({ historyIndex: 1 });
    resolveRender?.(bytes);
    await expect(stale).rejects.toMatchObject({
      outcome: 'stale',
    } satisfies Partial<AgentMediumPreviewAttachmentError>);
    expect(useEditorStore.getState().history).toBe(initialHistory);

    seedEditor();
    const timedOut = new AgentMediumPreviewAttachmentManager(() => new Promise<Uint8Array>(() => undefined));
    await expect(
      timedOut.acquire({ deadlineAt: Date.now() - 1, snapshot: buildAgentImageContextSnapshot() }),
    ).rejects.toMatchObject({
      outcome: 'timed_out',
    } satisfies Partial<AgentMediumPreviewAttachmentError>);

    const oversized = new AgentMediumPreviewAttachmentManager(
      async () => new Uint8Array(AGENT_MEDIUM_PREVIEW_MAX_BYTES + 1),
    );
    await expect(
      oversized.acquire({ deadlineAt: Date.now() + 5_000, snapshot: buildAgentImageContextSnapshot() }),
    ).rejects.toMatchObject({
      outcome: 'too_large',
    } satisfies Partial<AgentMediumPreviewAttachmentError>);

    const cancellation = new AbortController();
    cancellation.abort();
    const cancelled = new AgentMediumPreviewAttachmentManager(async () => bytes);
    await expect(
      cancelled.acquire({
        deadlineAt: Date.now() + 5_000,
        signal: cancellation.signal,
        snapshot: buildAgentImageContextSnapshot(),
      }),
    ).rejects.toMatchObject({ outcome: 'cancelled' } satisfies Partial<AgentMediumPreviewAttachmentError>);
    expect(useEditorStore.getState().historyIndex).toBe(0);
  });
});
