#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  ActorKind,
  previewScopeQueryV1Schema,
  previewScopeResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleRawEngineSceneColorPipelineV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const renderTarget = {
  bitDepth: 8,
  embedIcc: true,
  intent: 'relative_colorimetric',
  outputProfile: 'display_p3',
  viewTransform: 'rawengine_agx_v1',
} as const;

const exportScopeQuery = previewScopeQueryV1Schema.parse({
  actor: {
    id: 'codex-app-server',
    kind: ActorKind.Agent,
    sessionId: 'session_color_soft_proof_scopes',
  },
  correlationId: 'corr_color_soft_proof_scopes',
  parameters: {
    binCount: 16,
    includeScopes: ['histogram', 'waveform'],
    maxDimensionPx: 2048,
    renderBasis: 'export_preview',
    renderTarget,
    sourceArtifactId: 'artifact_soft_proof_preview_display_p3',
    workingSpace: 'acescg_linear_v1',
  },
  queryId: 'query_color_soft_proof_scopes',
  queryType: 'preview.scopes.read',
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: {
    imagePath: '/photos/session/IMG_4150.ARW',
    kind: 'image',
  },
});

if (
  previewScopeQueryV1Schema.safeParse({
    ...exportScopeQuery,
    parameters: { ...exportScopeQuery.parameters, renderTarget: undefined },
  }).success
) {
  throw new Error('export-preview scope query accepted a missing render target.');
}

const editorPreviewResult = previewScopeResultV1Schema.parse({
  colorManaged: true,
  colorPipeline: {
    ...sampleRawEngineSceneColorPipelineV1,
    renderTarget: { ...renderTarget, outputProfile: 'srgb' },
  },
  histogram: {
    binCount: 16,
    channels: [
      {
        bins: [0, 1, 2, 4, 8, 13, 21, 13, 8, 4, 2, 1, 1, 0, 0, 0],
        channel: 'luma',
        clippedHighRatio: 0.001,
        clippedLowRatio: 0.002,
        percentile01: 0.03,
        percentile99: 0.92,
      },
    ],
  },
  queryId: 'query_editor_preview_scopes',
  renderBasis: 'editor_preview',
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  sourceImagePath: exportScopeQuery.target.imagePath,
  warnings: [],
});

const exportPreviewResult = previewScopeResultV1Schema.parse({
  colorManaged: true,
  colorPipeline: {
    ...sampleRawEngineSceneColorPipelineV1,
    renderTarget,
  },
  histogram: {
    binCount: 16,
    channels: [
      {
        bins: [0, 0, 1, 2, 5, 10, 18, 16, 11, 7, 4, 2, 1, 1, 0, 0],
        channel: 'luma',
        clippedHighRatio: 0.0005,
        clippedLowRatio: 0.001,
        percentile01: 0.04,
        percentile99: 0.95,
      },
    ],
  },
  queryId: exportScopeQuery.queryId,
  renderBasis: 'export_preview',
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  softProof: {
    basis: 'export_preview',
    bitDepth: renderTarget.bitDepth,
    embedIcc: renderTarget.embedIcc,
    outputProfile: renderTarget.outputProfile,
    renderingIntent: renderTarget.intent,
    transformApplied: true,
    transformPolicyFingerprint: 'sha256:color-soft-proof-scopes-4150',
    viewTransform: renderTarget.viewTransform,
    warningCodes: ['export_profile_transform_applied', 'render_target_matches_export_recipe'],
  },
  sourceArtifactId: exportScopeQuery.parameters.sourceArtifactId,
  sourceImagePath: exportScopeQuery.target.imagePath,
  warnings: ['render_target_matches_export_recipe'],
});

if (
  previewScopeResultV1Schema.safeParse({
    ...exportPreviewResult,
    softProof: undefined,
  }).success
) {
  throw new Error('export-preview scope result accepted missing soft-proof metadata.');
}

const editorLuma = editorPreviewResult.histogram?.channels[0];
const exportLuma = exportPreviewResult.histogram?.channels[0];
if (editorLuma === undefined || exportLuma === undefined) {
  throw new Error('scope fixture lost luma histogram channels.');
}
if (editorLuma.percentile99 === exportLuma.percentile99 || editorLuma.bins.join(',') === exportLuma.bins.join(',')) {
  throw new Error('export-preview scope fixture must differ predictably from editor-preview scopes.');
}
if (
  exportPreviewResult.softProof?.outputProfile !== 'display_p3' ||
  exportPreviewResult.softProof.renderingIntent !== 'relative_colorimetric' ||
  exportPreviewResult.colorPipeline.workingSpace !== 'acescg_linear_v1' ||
  exportPreviewResult.colorPipeline.renderTarget?.outputProfile !== 'display_p3'
) {
  throw new Error('export-preview scope result lost working/display/output assumptions.');
}

const waveformSource = await readFile('src/components/panel/editor/Waveform.tsx', 'utf8');
for (const marker of [
  'data-preview-scope-render-basis',
  'data-preview-scope-soft-proof-transform-applied',
  'data-preview-scope-warning-codes',
  'data-export-profile-label',
  'data-export-rendering-intent-label',
]) {
  if (!waveformSource.includes(marker)) throw new Error(`Waveform missing soft-proof scope marker: ${marker}.`);
}

const listenerSource = await readFile('src/hooks/app/useTauriListeners.ts', 'utf8');
for (const marker of [
  'renderBasis: isExportPreview',
  'PREVIEW_SCOPE_EXPORT_SOURCE_LABEL',
  'export_profile_transform_applied',
  'render_target_matches_export_recipe',
]) {
  if (!listenerSource.includes(marker))
    throw new Error(`useTauriListeners missing soft-proof scope marker: ${marker}.`);
}

console.log('color soft-proof scopes ok');
