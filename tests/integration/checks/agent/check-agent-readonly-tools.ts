#!/usr/bin/env bun

import { z } from 'zod';
import { rawEngineDefaultToolRegistryV1 } from '../../../../packages/rawengine-schema/src/toolRegistry.ts';
import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import { RawEngineAppServerRouteMode } from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { isAgentPreviewEnvelopeCurrent } from '../../../../src/utils/agent/context/agentPreviewEnvelope.ts';
import {
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  AGENT_STATE_GET_TOOL_NAME,
  agentPreviewRenderRequestSchema,
  agentStateGetRequestSchema,
  getAgentReadOnlyState,
  getRawEngineImagePreview,
  RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
  rawEngineImageGetPreviewRequestSchema,
  rawEngineImageGetPreviewResponseSchema,
  renderAgentReadOnlyPreview,
} from '../../../../src/utils/agent/context/agentReadOnlyAppServerTools.ts';
import { AGENT_SELECTED_IMAGE_MODEL_TOOL_ALLOWLIST } from '../../../../src/utils/agent/session/agentSelectedImageModelToolLoop.ts';
import {
  buildRawEngineAppServerAuditEntry,
  buildRawEngineAppServerRouteCatalog,
} from '../../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3160.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 12 : 1));
const previewSubsetSchema = z
  .object({
    accessScope: z.literal('local_private'),
    artifactId: z.string().min(1),
    cacheKey: z.string().min(1),
    cachePolicy: z
      .object({
        invalidatesOn: z.array(z.string()).min(1),
        stableWhenRecipeHashMatches: z.boolean(),
      })
      .passthrough(),
    crop: z
      .object({
        height: z.number().positive(),
        unit: z.enum(['%', 'normalized', 'px']),
        width: z.number().positive(),
        x: z.number(),
        y: z.number(),
      })
      .nullable(),
    includesOriginalRaw: z.literal(false),
    lifecycle: z
      .object({
        expiresWith: z.array(z.string()).min(1),
        persisted: z.literal(false),
        storage: z.literal('ephemeral_editor_cache'),
      })
      .passthrough(),
    longEdgePx: z.number().int().positive(),
    maxPixelCount: z.number().int().positive(),
    previewRef: z.string().min(1),
    purpose: z.string().min(1),
    quality: z.number(),
    recipeHash: z.string().min(1),
    renderHash: z.string().min(1),
    renderIntent: z.string().min(1),
    source: z.literal('editor-preview-derivative'),
    zoom: z.unknown().nullable(),
  })
  .passthrough();
const snapshotSubsetSchema = z
  .object({
    initialPreview: previewSubsetSchema,
  })
  .passthrough();

useEditorStore.getState().setEditor({
  adjustments: { ...INITIAL_ADJUSTMENTS, exposure: 0.4, highlights: -12 },
  brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-readonly-preview',
  hasRenderedFirstFrame: true,
  histogram: {
    [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
    [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
    [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
    [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
  },
  history: [INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, exposure: 0.4, highlights: -12 }],
  historyIndex: 1,
  selectedImage: {
    exif: { ISO: '500', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3160',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3160',
    width: 6000,
  },
});

if (agentStateGetRequestSchema.safeParse({ requestId: 'state-1', unknown: true }).success) {
  throw new Error('agent.state.get request schema accepted an unknown field.');
}
if (agentPreviewRenderRequestSchema.safeParse({ longEdgePx: 8192, requestId: 'preview-1' }).success) {
  throw new Error('agent.preview.render request schema accepted an out-of-range preview size.');
}
if (rawEngineImageGetPreviewRequestSchema.safeParse({ requestId: 'image-preview-1', unknown: true }).success) {
  throw new Error('rawengine.image.get_preview request schema accepted an unknown field.');
}
if (
  agentPreviewRenderRequestSchema.safeParse({
    crop: { height: 0.4, width: 0.4, x: 0.8, y: 0.1 },
    requestId: 'preview-invalid-crop',
  }).success
) {
  throw new Error('agent.preview.render request schema accepted crop bounds outside the normalized image.');
}

const state = getAgentReadOnlyState({ requestId: 'state-1' });
const snapshot = snapshotSubsetSchema.parse(state.snapshot);
if (state.staleRecipeHash) {
  throw new Error('agent.state.get did not return the current read-only image context.');
}

const recipeHash = snapshot.initialPreview.recipeHash;
const preview = renderAgentReadOnlyPreview({
  expectedRecipeHash: recipeHash,
  longEdgePx: 1024,
  purpose: 'refresh',
  quality: 0.82,
  requestId: 'preview-1',
});
const previewPayload = previewSubsetSchema.parse(preview.preview);
if (preview.staleRecipeHash || previewPayload.longEdgePx !== 1024 || previewPayload.quality !== 0.82) {
  throw new Error('agent.preview.render did not honor bounded preview request parameters.');
}
if (
  previewPayload.purpose !== 'refresh' ||
  previewPayload.accessScope !== 'local_private' ||
  !previewPayload.artifactId.startsWith('artifact_refresh_') ||
  previewPayload.lifecycle.persisted ||
  !previewPayload.lifecycle.expiresWith.includes('recipe_hash_change') ||
  !previewPayload.lifecycle.expiresWith.includes('session_cancel') ||
  previewPayload.renderIntent !== 'refresh' ||
  !previewPayload.cacheKey.startsWith('agent-preview:refresh:') ||
  previewPayload.renderHash === snapshot.initialPreview.renderHash ||
  !previewPayload.cachePolicy.invalidatesOn.includes('recipe_hash')
) {
  throw new Error('agent.preview.render did not return a standardized refresh preview envelope.');
}

const detailPreview = renderAgentReadOnlyPreview({
  crop: { height: 0.3, width: 0.25, x: 0.2, y: 0.15 },
  expectedRecipeHash: recipeHash,
  longEdgePx: 2048,
  maxPixelCount: 1_000_000,
  purpose: 'detail_review',
  quality: 0.9,
  requestId: 'preview-detail',
  zoom: { centerX: 0.4, centerY: 0.6, scale: 2 },
});
const detailPreviewPayload = previewSubsetSchema.parse(detailPreview.preview);
if (
  detailPreviewPayload.purpose !== 'detail_review' ||
  detailPreviewPayload.longEdgePx !== 2048 ||
  detailPreviewPayload.maxPixelCount !== 1_000_000 ||
  detailPreviewPayload.crop?.unit !== 'normalized' ||
  detailPreviewPayload.crop.width !== 0.25 ||
  detailPreviewPayload.zoom === null ||
  detailPreviewPayload.cacheKey === previewPayload.cacheKey
) {
  throw new Error('agent.preview.render did not encode detail-review crop/zoom semantics.');
}
if (detailPreviewPayload.width * detailPreviewPayload.height > 1_000_000) {
  throw new Error('agent.preview.render exceeded the requested crop preview pixel budget.');
}

const repeatedDetailPreview = renderAgentReadOnlyPreview({
  crop: { height: 0.3, width: 0.25, x: 0.2, y: 0.15 },
  expectedRecipeHash: recipeHash,
  longEdgePx: 2048,
  maxPixelCount: 1_000_000,
  purpose: 'detail_review',
  quality: 0.9,
  requestId: 'preview-detail',
  zoom: { centerX: 0.4, centerY: 0.6, scale: 2 },
});
if (repeatedDetailPreview.preview.cacheKey !== detailPreview.preview.cacheKey) {
  throw new Error('agent.preview.render crop preview metadata must be deterministic for matching requests.');
}
if (!isAgentPreviewEnvelopeCurrent({ preview: repeatedDetailPreview.preview, recipeHash })) {
  throw new Error('agent.preview.render must mark matching private previews current for their recipe hash.');
}
if (isAgentPreviewEnvelopeCurrent({ preview: repeatedDetailPreview.preview, recipeHash: 'recipe:other' })) {
  throw new Error('agent.preview.render private previews must invalidate when recipe hashes change.');
}

const stalePreview = renderAgentReadOnlyPreview({
  expectedRecipeHash: 'recipe:stale',
  requestId: 'preview-stale',
});
if (!stalePreview.staleRecipeHash) {
  throw new Error('agent.preview.render did not flag a stale expected recipe hash.');
}
if (previewPayload.previewRef === 'blob:rawengine-original-3160' || previewPayload.includesOriginalRaw) {
  throw new Error('agent.preview.render must not return the original RAW by default.');
}

const imagePreview = getRawEngineImagePreview({ expectedRecipeHash: recipeHash, requestId: 'image-preview-1' });
const imagePreviewPayload = rawEngineImageGetPreviewResponseSchema.parse(imagePreview);
if (
  imagePreviewPayload.toolName !== RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME ||
  imagePreviewPayload.staleRecipeHash ||
  imagePreviewPayload.preview.purpose !== 'initial_context' ||
  imagePreviewPayload.preview.longEdgePx !== 1536 ||
  imagePreviewPayload.preview.quality !== 0.86 ||
  imagePreviewPayload.preview.includesOriginalRaw ||
  imagePreviewPayload.preview.previewRef === 'blob:rawengine-original-3160' ||
  imagePreviewPayload.dimensions.width !== imagePreviewPayload.preview.width ||
  imagePreviewPayload.dimensions.height !== imagePreviewPayload.preview.height ||
  imagePreviewPayload.dimensions.sourceWidth !== 6000 ||
  imagePreviewPayload.dimensions.sourceHeight !== 4000 ||
  imagePreviewPayload.editRevision.graphRevision !== 'history_1' ||
  imagePreviewPayload.editRevision.recipeHash !== imagePreviewPayload.preview.recipeHash ||
  imagePreviewPayload.editRevision.renderHash !== imagePreviewPayload.preview.renderHash ||
  imagePreviewPayload.color.encodedProfile !== 'srgb-preview' ||
  !imagePreviewPayload.color.note.includes('not the original RAW')
) {
  throw new Error('rawengine.image.get_preview did not return bounded medium preview metadata.');
}
const staleImagePreview = getRawEngineImagePreview({
  expectedRecipeHash: 'recipe:stale',
  requestId: 'image-preview-stale',
});
if (!staleImagePreview.staleRecipeHash) {
  throw new Error('rawengine.image.get_preview did not flag stale expected recipe hash.');
}
const imagePreviewRegistryEntry = rawEngineDefaultToolRegistryV1.tools.find(
  (tool) => tool.toolName === RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
);
if (
  imagePreviewRegistryEntry === undefined ||
  imagePreviewRegistryEntry.mutates ||
  imagePreviewRegistryEntry.toolKind !== 'read' ||
  imagePreviewRegistryEntry.approvalClass !== 'safe_read' ||
  imagePreviewRegistryEntry.requiresDryRun ||
  !imagePreviewRegistryEntry.returnsArtifactHandles
) {
  throw new Error('rawengine.image.get_preview is not registered as a safe read-only artifact-handle tool.');
}
const imagePreviewAudit = buildRawEngineAppServerAuditEntry({
  requestId: 'image-preview-audit-1',
  timestampIso: '2026-07-01T00:00:00.000Z',
  toolName: RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
});
if (imagePreviewAudit.mutates || imagePreviewAudit.toolKind !== 'read') {
  throw new Error('rawengine.image.get_preview audit entry must replay as read-only.');
}

const catalog = buildRawEngineAppServerRouteCatalog();
for (const forbidden of [
  'rawengine.agent.adjustments.apply',
  'rawengine.agent.history.rollback',
  'rawengine.agent.final_export',
]) {
  if ((AGENT_SELECTED_IMAGE_MODEL_TOOL_ALLOWLIST as readonly string[]).includes(forbidden)) {
    throw new Error(`production selected-image model loop exposes mutating tool ${forbidden}.`);
  }
}
for (const toolName of [
  AGENT_STATE_GET_TOOL_NAME,
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
]) {
  const route = catalog.find((candidate) => candidate.commandName === toolName);
  if (route === undefined || route.family !== 'agent' || !route.modes.includes(RawEngineAppServerRouteMode.Read)) {
    throw new Error(`${toolName} is missing from the read-only agent route catalog.`);
  }
}

console.log('agent read-only tools ok');
