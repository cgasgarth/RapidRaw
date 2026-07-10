import { z } from 'zod';

import {
  type RawEngineAgentInitialPreviewReceiptV2,
  type RawEngineAgentMediumPreviewAttachmentV2,
  rawEngineAgentInitialPreviewReceiptV2Schema,
  rawEngineAgentMediumPreviewAttachmentV2Schema,
} from '../../../../packages/rawengine-schema/src/localAppServerBridge';
import { useEditorStore } from '../../../store/useEditorStore';
import { Invokes } from '../../../tauri/commands';
import { type AgentImageContextSnapshot, buildAgentImageContextSnapshot } from './agentImageContextSnapshot';
import {
  AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX,
  AGENT_MEDIUM_PREVIEW_QUALITY,
  stableAgentPreviewHash,
} from './agentPreviewEnvelope';

export const AGENT_MEDIUM_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
export const AGENT_MEDIUM_PREVIEW_TTL_MS = 60_000;
export const AGENT_MEDIUM_PREVIEW_CACHE_LIMIT = 8;

export const agentModelImageAttachmentSchema = z
  .object({
    attachment: rawEngineAgentMediumPreviewAttachmentV2Schema,
    payloadBase64: z.string().trim().min(1),
    type: z.literal('image'),
  })
  .strict();

export type AgentModelImageAttachment = z.infer<typeof agentModelImageAttachmentSchema>;

export class AgentMediumPreviewAttachmentError extends Error {
  constructor(
    readonly outcome: 'cancelled' | 'decode_failed' | 'failed' | 'stale' | 'timed_out' | 'too_large',
    message: string,
  ) {
    super(message);
    this.name = 'AgentMediumPreviewAttachmentError';
  }
}

export type AgentMediumPreviewRenderer = (input: {
  adjustments?: unknown;
  signal?: AbortSignal;
  snapshot: AgentImageContextSnapshot;
}) => Promise<Uint8Array>;

export interface AgentMediumPreviewOutputIdentity {
  graphRevision: string;
  recipeHash: string;
  renderHash: string;
  selectedImageId?: string;
}

type StoredAttachment = {
  attachment: RawEngineAgentMediumPreviewAttachmentV2;
  bytes: Uint8Array;
  cacheKey: string;
};

const previewColorPipeline = {
  encodedProfile: 'srgb-preview' as const,
  outputProfile: 'srgb' as const,
  previewTransform: 'editor-preview-to-srgb-jpeg' as const,
  workingSpace: 'rawengine-scene-linear' as const,
};

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export const sha256ForAgentPreviewBytes = async (bytes: Uint8Array): Promise<string> => {
  const normalizedBytes = new Uint8Array(bytes.byteLength);
  normalizedBytes.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', normalizedBytes);
  return `sha256:${toHex(new Uint8Array(digest))}`;
};

const binaryStringFromBytes = (bytes: Uint8Array): string => {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 32_768)));
  }
  return chunks.join('');
};

const toBase64 = (bytes: Uint8Array): string => {
  if (typeof btoa !== 'function') throw new Error('Base64 encoding is unavailable for a preview attachment.');
  return btoa(binaryStringFromBytes(bytes));
};

export const decodeAgentJpegDimensions = (bytes: Uint8Array): { height: number; width: number } => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new AgentMediumPreviewAttachmentError('decode_failed', 'Preview bytes are not a JPEG stream.');
  }

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segmentLength = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0);
      const width = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      if (height > 0 && width > 0) return { height, width };
    }
    offset += segmentLength;
  }
  throw new AgentMediumPreviewAttachmentError('decode_failed', 'JPEG preview decode did not expose dimensions.');
};

const snapshotIdentity = (snapshot: AgentImageContextSnapshot) => ({
  graphRevision: snapshot.graphRevision,
  recipeHash: snapshot.initialPreview.recipeHash,
  renderHash: snapshot.initialPreview.renderHash,
  selectedImagePath: snapshot.activeImagePath,
});

const identityMatches = (left: AgentImageContextSnapshot, right: AgentImageContextSnapshot): boolean => {
  const expected = snapshotIdentity(left);
  const current = snapshotIdentity(right);
  return (
    expected.graphRevision === current.graphRevision &&
    expected.recipeHash === current.recipeHash &&
    expected.renderHash === current.renderHash &&
    expected.selectedImagePath === current.selectedImagePath
  );
};

const buildCacheKey = (
  snapshot: AgentImageContextSnapshot,
  outputIdentity: AgentMediumPreviewOutputIdentity | undefined,
): string => {
  const identity = snapshotIdentity(snapshot);
  return [
    identity.selectedImagePath,
    identity.graphRevision,
    identity.recipeHash,
    identity.renderHash,
    outputIdentity?.graphRevision ?? identity.graphRevision,
    outputIdentity?.recipeHash ?? identity.recipeHash,
    outputIdentity?.renderHash ?? identity.renderHash,
    outputIdentity?.selectedImageId ?? '',
  ].join(':');
};

export const renderAgentMediumPreviewNative = async ({
  adjustments,
  signal,
  snapshot,
}: {
  adjustments?: unknown;
  signal?: AbortSignal;
  snapshot: AgentImageContextSnapshot;
}): Promise<Uint8Array> => {
  if (signal?.aborted) throw new AgentMediumPreviewAttachmentError('cancelled', 'Preview acquisition was cancelled.');
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = await invoke<Uint8Array>(Invokes.GeneratePreviewForPath, {
    jpegQuality: Math.round(AGENT_MEDIUM_PREVIEW_QUALITY * 100),
    jsAdjustments: structuredClone(adjustments ?? useEditorStore.getState().adjustments),
    path: snapshot.activeImagePath,
    targetResolution: AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX,
  });
  return new Uint8Array(bytes);
};

const defaultNativeRenderer: AgentMediumPreviewRenderer = ({ adjustments, signal, snapshot }) =>
  renderAgentMediumPreviewNative({
    ...(adjustments === undefined ? {} : { adjustments }),
    ...(signal === undefined ? {} : { signal }),
    snapshot,
  });

const promiseWithDeadline = async <Value>(promise: Promise<Value>, deadlineAt: number): Promise<Value> => {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) {
    throw new AgentMediumPreviewAttachmentError('timed_out', 'Preview acquisition deadline expired.');
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<Value>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new AgentMediumPreviewAttachmentError('timed_out', 'Preview acquisition deadline expired.')),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

export class AgentMediumPreviewAttachmentManager {
  private readonly cache = new Map<string, StoredAttachment>();
  private readonly inFlight = new Map<string, Promise<StoredAttachment>>();
  private readonly released = new Map<string, RawEngineAgentMediumPreviewAttachmentV2>();

  constructor(
    private readonly renderer: AgentMediumPreviewRenderer = defaultNativeRenderer,
    private readonly now: () => number = Date.now,
  ) {}

  async acquire({
    adjustments,
    deadlineAt,
    outputIdentity,
    signal,
    snapshot,
  }: {
    adjustments?: unknown;
    deadlineAt: number;
    outputIdentity?: AgentMediumPreviewOutputIdentity;
    signal?: AbortSignal;
    snapshot: AgentImageContextSnapshot;
  }): Promise<AgentModelImageAttachment> {
    if (signal?.aborted) throw new AgentMediumPreviewAttachmentError('cancelled', 'Preview acquisition was cancelled.');
    const cacheKey = buildCacheKey(snapshot, outputIdentity);
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined && Date.parse(cached.attachment.expiresAt) > this.now()) {
      return this.toModelAttachment(cached);
    }
    if (cached !== undefined) this.release(cached.attachment.artifactId, 'released');

    const inFlight = this.inFlight.get(cacheKey);
    if (inFlight !== undefined) return this.toModelAttachment(await inFlight);

    const acquisition = this.createAttachment({
      cacheKey,
      ...(adjustments === undefined ? {} : { adjustments }),
      deadlineAt,
      ...(outputIdentity === undefined ? {} : { outputIdentity }),
      ...(signal === undefined ? {} : { signal }),
      snapshot,
    });
    this.inFlight.set(cacheKey, acquisition);
    try {
      return this.toModelAttachment(await acquisition);
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  release(artifactId: string, status: 'released' | 'stale' | 'superseded' = 'released'): void {
    for (const [cacheKey, stored] of this.cache) {
      if (stored.attachment.artifactId !== artifactId) continue;
      stored.bytes = new Uint8Array();
      stored.attachment.lifecycle.status = status;
      this.cache.delete(cacheKey);
      this.released.set(artifactId, stored.attachment);
      return;
    }
  }

  releaseAll(status: 'released' | 'stale' | 'superseded' = 'released'): void {
    for (const stored of [...this.cache.values()]) this.release(stored.attachment.artifactId, status);
  }

  getAuditAttachment(artifactId: string): RawEngineAgentMediumPreviewAttachmentV2 | undefined {
    for (const stored of this.cache.values()) {
      if (stored.attachment.artifactId === artifactId) return stored.attachment;
    }
    return this.released.get(artifactId);
  }

  private async createAttachment({
    adjustments,
    cacheKey,
    deadlineAt,
    outputIdentity,
    signal,
    snapshot,
  }: {
    adjustments?: unknown;
    cacheKey: string;
    deadlineAt: number;
    outputIdentity?: AgentMediumPreviewOutputIdentity;
    signal?: AbortSignal;
    snapshot: AgentImageContextSnapshot;
  }): Promise<StoredAttachment> {
    const bytes = await promiseWithDeadline(
      this.renderer({
        ...(adjustments === undefined ? {} : { adjustments }),
        ...(signal === undefined ? {} : { signal }),
        snapshot,
      }),
      deadlineAt,
    );
    if (signal?.aborted) throw new AgentMediumPreviewAttachmentError('cancelled', 'Preview acquisition was cancelled.');
    if (bytes.byteLength > AGENT_MEDIUM_PREVIEW_MAX_BYTES) {
      throw new AgentMediumPreviewAttachmentError('too_large', 'Preview attachment exceeded the 8 MiB cap.');
    }
    const dimensions = decodeAgentJpegDimensions(bytes);
    if (
      Math.max(dimensions.width, dimensions.height) !== AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX ||
      dimensions.width !== snapshot.initialPreview.width ||
      dimensions.height !== snapshot.initialPreview.height
    ) {
      throw new AgentMediumPreviewAttachmentError(
        'decode_failed',
        'Native preview dimensions did not match the selected revision.',
      );
    }
    let current: AgentImageContextSnapshot;
    try {
      current = buildAgentImageContextSnapshot();
    } catch {
      throw new AgentMediumPreviewAttachmentError('stale', 'Selected image changed before preview delivery.');
    }
    if (!identityMatches(snapshot, current)) {
      throw new AgentMediumPreviewAttachmentError('stale', 'Selected image revision changed before preview delivery.');
    }

    const contentHash = await sha256ForAgentPreviewBytes(bytes);
    const snapshotRevision = snapshotIdentity(snapshot);
    const identity = {
      graphRevision: outputIdentity?.graphRevision ?? snapshotRevision.graphRevision,
      recipeHash: outputIdentity?.recipeHash ?? snapshotRevision.recipeHash,
      renderHash: outputIdentity?.renderHash ?? snapshotRevision.renderHash,
      selectedImagePath: snapshotRevision.selectedImagePath,
    };
    const revisionToken = await sha256ForAgentPreviewBytes(
      new TextEncoder().encode(
        `${identity.selectedImagePath}:${identity.graphRevision}:${identity.recipeHash}:${identity.renderHash}`,
      ),
    );
    const artifactId = `agent-medium-preview:${contentHash.slice('sha256:'.length, 24)}`;
    const createdAt = new Date(this.now()).toISOString();
    const attachment = rawEngineAgentMediumPreviewAttachmentV2Schema.parse({
      accessScope: 'local_private',
      artifactId,
      byteLength: bytes.byteLength,
      colorPipeline: previewColorPipeline,
      contentHash,
      createdAt,
      dimensions,
      encodedFormat: 'jpeg',
      expiresAt: new Date(this.now() + AGENT_MEDIUM_PREVIEW_TTL_MS).toISOString(),
      includesOriginalRaw: false,
      lifecycle: {
        releaseToken: `release:${stableAgentPreviewHash(`${artifactId}:${createdAt}`)}`,
        status: 'ready',
      },
      longEdgePx: AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX,
      mediaType: 'image/jpeg',
      quality: AGENT_MEDIUM_PREVIEW_QUALITY,
      revision: {
        graphRevision: identity.graphRevision,
        recipeHash: identity.recipeHash,
        renderHash: identity.renderHash,
        revisionToken,
        selectedImageId:
          outputIdentity?.selectedImageId ?? `image:${stableAgentPreviewHash(identity.selectedImagePath)}`,
      },
      transport: {
        handle: `attachment:${stableAgentPreviewHash(`${artifactId}:${revisionToken}`)}`,
        kind: 'opaque_ephemeral_handle',
      },
    });
    const stored = { attachment, bytes, cacheKey };
    this.cache.set(cacheKey, stored);
    while (this.cache.size > AGENT_MEDIUM_PREVIEW_CACHE_LIMIT) {
      const oldest = this.cache.values().next().value;
      if (oldest === undefined) break;
      this.release(oldest.attachment.artifactId, 'released');
    }
    return stored;
  }

  private toModelAttachment(stored: StoredAttachment): AgentModelImageAttachment {
    if (stored.attachment.lifecycle.status !== 'ready') {
      throw new AgentMediumPreviewAttachmentError('stale', 'Preview attachment is no longer available.');
    }
    return agentModelImageAttachmentSchema.parse({
      attachment: stored.attachment,
      payloadBase64: toBase64(stored.bytes),
      type: 'image',
    });
  }
}

export const buildAgentInitialPreviewReceiptV2 = ({
  attachment,
  requestId,
  sessionId,
}: {
  attachment: RawEngineAgentMediumPreviewAttachmentV2;
  requestId: string;
  sessionId: string;
}): RawEngineAgentInitialPreviewReceiptV2 =>
  rawEngineAgentInitialPreviewReceiptV2Schema.parse({
    attachment,
    requestId,
    schemaVersion: 2,
    sessionId,
    toolName: 'rawengine.image.get_preview',
  });

export let agentMediumPreviewAttachmentManager = new AgentMediumPreviewAttachmentManager();

export const setAgentMediumPreviewAttachmentRendererForTest = (
  renderer: AgentMediumPreviewRenderer | undefined,
): void => {
  agentMediumPreviewAttachmentManager.releaseAll();
  agentMediumPreviewAttachmentManager = new AgentMediumPreviewAttachmentManager(renderer);
};
