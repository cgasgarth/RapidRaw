#!/usr/bin/env bun

import { mock } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildPanoramaUiDryRunCommandV1 } from '../../../../packages/rawengine-schema/src/panorama/panoramaUiControls.ts';
import { DEFAULT_PANORAMA_UI_SETTINGS } from '../../../../src/schemas/computational-merge/panoramaUiSchemas.ts';
import { createDefaultPanoramaModalState, type PanoramaModalState } from '../../../../src/store/useUIStore.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../../src/utils/computational-merge/computationalMergeAppServerRoutePairs.ts';
import {
  buildPanoramaApplyCommandState,
  buildPanoramaDryRunCommandState,
  resetPanoramaStateForSettingsChange,
} from '../../../../src/utils/computational-merge/computationalMergeModalState.ts';

mock.module('react-i18next', () => ({
  Trans: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.count === undefined ? key : `${key}:${String(values.count)}`,
  }),
}));

const PanoramaModal = (await import('../../../../src/components/modals/computational-merge/PanoramaModal.tsx')).default;

const failures: string[] = [];
const routePair = getComputationalMergeAppServerRoutePairSummary('panorama');
const sourcePaths = [
  '/private-fixtures/panorama/overlap-stitch-v1/frame-01.raf',
  '/private-fixtures/panorama/overlap-stitch-v1/frame-02.raf',
  '/private-fixtures/panorama/overlap-stitch-v1/frame-03.raf',
];
const settings = {
  ...DEFAULT_PANORAMA_UI_SETTINGS,
  blendMode: 'feather',
  boundaryMode: 'auto_crop',
  exposureMode: 'none',
  maxPreviewDimensionPx: 8192,
  projection: 'rectilinear',
  qualityPreference: 'preview',
} as const;
const packageCommand = buildPanoramaUiDryRunCommandV1(
  {
    blendMode: settings.blendMode,
    boundaryMode: settings.boundaryMode,
    exposureMode: settings.exposureMode,
    maxPreviewDimensionPx: settings.maxPreviewDimensionPx,
    outputName: 'Panorama dry-run preview',
    projection: settings.projection,
    qualityPreference: settings.qualityPreference,
    sources: sourcePaths.map((imagePath, sourceIndex) => ({ imagePath, sourceIndex })),
  },
  {
    commandId: 'command_panorama_ui_action_boundary_dry_run',
    correlationId: 'corr_panorama_ui_action_boundary_dry_run',
    expectedGraphRevision: 'graph_rev_panorama_ui_action_boundary',
    targetId: 'project_panorama_ui',
  },
);

const lastDryRunCommand = buildPanoramaDryRunCommandState(sourcePaths, settings);
const lastApplyCommand = buildPanoramaApplyCommandState({ base64Length: 31, sourceCount: sourcePaths.length });

if (lastDryRunCommand.appServerToolName !== routePair.dryRunToolName) {
  failures.push('Panorama start action must store the typed app-server dry-run route.');
}
if (lastDryRunCommand.sourceCount !== packageCommand.parameters.sources.length) {
  failures.push('Panorama UI action source count must match package command builder.');
}
if (packageCommand.parameters.sources.some((source) => source.role !== 'panorama_tile')) {
  failures.push('Package panorama UI command sources must use panorama_tile roles.');
}
if (settings.projection !== packageCommand.parameters.projection) {
  failures.push('Panorama UI action projection must match package command builder.');
}
if (settings.boundaryMode !== packageCommand.parameters.boundaryMode) {
  failures.push('Panorama UI action boundary mode must match package command builder.');
}
if ('none' !== packageCommand.parameters.exposureNormalization) {
  failures.push('Panorama UI action exposure normalization must match package command builder.');
}
if (lastApplyCommand.toolName !== routePair.applyToolName || lastApplyCommand.dryRun !== false) {
  failures.push(
    'Panorama complete listener must store mutating apply command metadata with the typed app-server route.',
  );
}
if (lastApplyCommand.acceptedDryRunPlanHash !== 'sha256:panorama-preview-31') {
  failures.push('Panorama apply command metadata must preserve the accepted dry-run hash.');
}

const staleState: PanoramaModalState = {
  ...createDefaultPanoramaModalState(settings),
  error: 'stale error',
  finalImageBase64: 'data:image/png;base64,stale',
  isProcessing: true,
  lastApplyCommand,
  lastDryRunCommand,
  progressMessage: 'stale progress',
  renderedReview: {
    boundary: {
      crop: { height: 90, mode: 'auto', preCropHeight: 100, preCropWidth: 200, width: 180, x: 0, y: 0 },
      effective: 'auto_crop',
      requested: 'auto_crop',
    },
    capabilityLevel: 'runtime_apply_capable',
    exposureNormalizationSummary: {
      appliedGainCount: 1,
      appliedLuminanceGains: [{ gain: 0.95, sourceIndex: 1 }],
      compensationStrengthPercent: 100,
      medianLogLuminanceDeltaAfter: 0.02,
      medianLogLuminanceDeltaBefore: 0.12,
      mode: 'scalar_overlap_luminance_gain_v1',
    },
    outputDimensions: { height: 90, width: 180 },
    projection: { effective: settings.projection, requested: settings.projection },
    seamReview: {
      contributionMapArtifactId: 'artifact_panorama_ui_action_contribution_map',
      overlapConfidence: {
        edgeCount: 2,
        level: 'high',
        meanConfidenceScore: 0.86,
        minimumConfidenceScore: 0.82,
        minimumOverlapRatio: 0.3,
        weakEdgeCount: 0,
      },
      policy: 'adaptive_dp_feather_v1',
      reviewStatus: 'ready',
      seamCount: 2,
      seamMaskArtifactId: 'artifact_panorama_ui_action_seam_mask',
      seams: [],
      seamWarningState: {
        parallaxRisk: 'low',
        state: 'clear',
        warningCodes: [],
      },
    },
    sources: {
      excludedSourceIndices: [],
      stitchedSourceIndices: [0, 1, 2],
      totalCount: 3,
    },
    sourceContribution: {
      excludedSourceCount: 0,
      regions: sourcePaths.map((_path, sourceIndex) => ({
        coverageRatio: 1 / sourcePaths.length,
        role: 'stitched',
        sourceIndex,
      })),
      stitchedSourceCount: sourcePaths.length,
    },
  },
  runtimePlan: {
    dry_run: true,
    family: 'panorama',
    output_dimensions: { height: 90, width: 180 },
    preflight: {
      blocked_reasons: [],
      execution_mode: 'full_frame_legacy',
      memory_budget_bytes: 256_000_000,
      memory_budget_ratio: 0.01,
      memory_components: { total_estimated_peak_bytes: 123_456 },
      source_geometry: {
        blocked_reasons: [],
        layout: 'single_row',
        row_count_estimate: 1,
        support: 'implemented_current_engine',
        vertical_span_px: 0,
        warning_codes: [],
      },
      status: 'accepted',
      tile_count: 1,
      warning_codes: [],
    },
    source_image_refs: sourcePaths.map((image_path, source_index) => ({ image_path, source_index })),
    warnings: [],
  },
};
const resetState = resetPanoramaStateForSettingsChange(staleState, {
  ...settings,
  projection: 'cylindrical',
});

if (resetState.error !== null || resetState.finalImageBase64 !== null || resetState.progressMessage !== null) {
  failures.push('Panorama settings changes must clear stale error/output/progress state.');
}
if (resetState.lastDryRunCommand !== null || resetState.lastApplyCommand !== null) {
  failures.push('Panorama settings changes must clear stale dry-run and apply command metadata.');
}
if (resetState.renderedReview !== null || resetState.runtimePlan !== null) {
  failures.push('Panorama settings changes must clear stale rendered review and runtime plan state.');
}

const dryRunAttrs = renderedAttrs(
  'panorama-dry-run-command-state',
  React.createElement(PanoramaModal, {
    error: null,
    finalImageBase64: null,
    imageCount: sourcePaths.length,
    isOpen: true,
    isProcessing: true,
    lastApplyCommand: null,
    lastDryRunCommand,
    onClose: noop,
    onOpenFile: noop,
    onSave: async () => '/tmp/panorama.tif',
    onSettingsChange: noop,
    onStitch: noop,
    progressMessage: 'Starting panorama',
    renderedReview: null,
    runtimePlan: null,
    settings,
    sourcePaths,
  }),
);
assertAttr(
  dryRunAttrs,
  'data-tool-name',
  routePair.dryRunToolName,
  'Panorama processing UI must render dry-run tool name.',
);
assertAttr(dryRunAttrs, 'data-source-count', '3', 'Panorama processing UI must render dry-run source count.');
assertAttr(dryRunAttrs, 'data-dry-run', 'true', 'Panorama processing UI must render dry-run mode.');

const applyAttrs = renderedAttrs(
  'panorama-apply-command-state',
  React.createElement(PanoramaModal, {
    error: null,
    finalImageBase64: 'data:image/png;base64,cGFub3JhbWEtcHJldmlldw==',
    imageCount: sourcePaths.length,
    isOpen: true,
    isProcessing: false,
    lastApplyCommand,
    lastDryRunCommand,
    onClose: noop,
    onOpenFile: noop,
    onSave: async () => '/tmp/panorama.tif',
    onSettingsChange: noop,
    onStitch: noop,
    progressMessage: null,
    renderedReview: null,
    runtimePlan: null,
    settings,
    sourcePaths,
  }),
);
assertAttr(applyAttrs, 'data-tool-name', routePair.applyToolName, 'Panorama result UI must render apply tool name.');
assertAttr(
  applyAttrs,
  'data-accepted-dry-run-plan-hash',
  'sha256:panorama-preview-31',
  'Panorama result UI must render accepted dry-run hash.',
);
assertAttr(applyAttrs, 'data-dry-run', 'false', 'Panorama result UI must render mutating apply mode.');

if (failures.length > 0) {
  console.error('panorama UI action command failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `panorama UI action command ok (${lastDryRunCommand.appServerToolName}, sources=${lastDryRunCommand.sourceCount})`,
);

function renderedAttrs(testId: string, element: React.ReactElement): Record<string, string> {
  const html = renderToStaticMarkup(element);
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`, 'u'));
  if (!match) {
    failures.push(`Rendered panorama modal missing ${testId}.`);
    return {};
  }
  return Object.fromEntries([...match[0].matchAll(/\s(data-[\w-]+)="([^"]*)"/gu)].map((attr) => [attr[1], attr[2]]));
}

function assertAttr(attrs: Record<string, string>, name: string, expected: string, message: string) {
  if (attrs[name] !== expected) {
    failures.push(`${message} Expected ${name}=${expected}, received ${attrs[name] ?? '<missing>'}.`);
  }
}

function noop() {}
