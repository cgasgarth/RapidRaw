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

const fixturePath = new URL('../../../docs/baseline/render/rapidraw-vite-empty-root-2026-06-10.jpg', import.meta.url);
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

const withMediumPreviewDimensions = (bytes: Uint8Array): Uint8Array => {
  const result = new Uint8Array(bytes);
  for (let index = 0; index + 8 < result.length; index += 1) {
    if (result[index] !== 0xff || result[index + 1] !== 0xc0) continue;
    result[index + 5] = 0x04;
    result[index + 6] = 0x00;
    result[index + 7] = 0x06;
    result[index + 8] = 0x00;
    return result;
  }
  throw new Error('JPEG fixture is missing a baseline SOF segment.');
};

describe('agent medium preview attachment runtime', () => {
  beforeEach(() => {
    seedEditor();
  });

  test('uses a decodable JPEG and its true SHA-256 bytes identity', async () => {
    const bytes = await loadFixture();

    expect(decodeAgentJpegDimensions(bytes)).toEqual({ height: 1044, width: 781 });
    expect(await sha256ForAgentPreviewBytes(bytes)).toBe(
      'sha256:c78b1b23d8fbfc1a8609b58e3f56ae901c4374a03e4fa70a9072fd6fec7a4b74',
    );
  });

  test('deduplicates one revision-bound attachment and redacts private source identity from the receipt', async () => {
    const bytes = await loadFixture();
    const mediumPreviewBytes = withMediumPreviewDimensions(bytes);
    let renderCount = 0;
    const manager = new AgentMediumPreviewAttachmentManager(async () => {
      renderCount += 1;
      return new Uint8Array(mediumPreviewBytes);
    });
    const snapshot = buildAgentImageContextSnapshot();
    const deadlineAt = Date.now() + 5_000;
    const [first, second] = await Promise.all([
      manager.acquire({ deadlineAt, snapshot }),
      manager.acquire({ deadlineAt, snapshot }),
    ]);

    expect(renderCount).toBe(1);
    expect(first.attachment.artifactId).toBe(second.attachment.artifactId);
    expect(first.attachment.contentHash).toBe(await sha256ForAgentPreviewBytes(mediumPreviewBytes));
    expect(first.attachment.revision).toMatchObject({
      graphRevision: snapshot.graphRevision,
      recipeHash: snapshot.initialPreview.recipeHash,
      renderHash: snapshot.initialPreview.renderHash,
    });
    expect(first.attachment.dimensions).toEqual({ height: 1024, width: 1536 });
    expect(first.attachment.byteLength).toBe(mediumPreviewBytes.byteLength);
    expect(first.attachment.includesOriginalRaw).toBe(false);
    expect(JSON.stringify(first.attachment)).not.toContain(selectedPath);

    manager.release(first.attachment.artifactId);
    expect(manager.getAuditAttachment(first.attachment.artifactId)?.lifecycle.status).toBe('released');
  });

  test('fails closed on revision drift, timeout, and oversized bytes without changing the editor', async () => {
    const bytes = withMediumPreviewDimensions(await loadFixture());
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
