#!/usr/bin/env bun

import { mock } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildHdrMergeUiDryRunCommandV1 } from '../../../packages/rawengine-schema/src/hdrMergeUiControls.ts';
import type { ImageFile } from '../../../src/components/ui/AppProperties.tsx';
import { DEFAULT_HDR_MERGE_UI_SETTINGS } from '../../../src/schemas/hdrMergeUiSchemas.ts';
import { createDefaultHdrModalState, type HdrModalState } from '../../../src/store/useUIStore.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computational-merge/computationalMergeAppServerRoutePairs.ts';
import {
  buildHdrApplyCommandState,
  buildHdrDryRunActionState,
  resetHdrStateForSettingsChange,
} from '../../../src/utils/computational-merge/computationalMergeModalState.ts';
import { findHdrAutoStackPaths } from '../../../src/utils/hdrAutoStackSelection.ts';

mock.module('react-i18next', () => ({
  Trans: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.count === undefined ? key : `${key}:${String(values.count)}`,
  }),
}));

const HdrModal = (await import('../../../src/components/modals/computational-merge/HdrModal.tsx')).default;

const failures: string[] = [];
const routePair = getComputationalMergeAppServerRoutePairSummary('hdr');
const sourcePaths = [
  '/private-fixtures/hdr/bracket-alignment-v1/frame-01-under.arw',
  '/private-fixtures/hdr/bracket-alignment-v1/frame-02-mid.arw',
  '/private-fixtures/hdr/bracket-alignment-v1/frame-03-over.arw',
];
const settings = {
  ...DEFAULT_HDR_MERGE_UI_SETTINGS,
  alignmentMode: 'auto',
  bracketValidation: 'required',
  deghostConfidenceMapVisible: true,
  deghostRegionIntensityPercent: 85,
  deghosting: 'medium',
  maxPreviewDimensionPx: 4096,
  mergeStrategy: 'scene_linear_radiance',
  qualityPreference: 'balanced',
  selectedSourceIndexes: [0, 1, 2],
  toneMapPreview: true,
  toneMappingPreset: 'highlight_detail',
} as const;

const packageCommand = buildHdrMergeUiDryRunCommandV1(
  {
    alignmentMode: settings.alignmentMode,
    bracketValidation: settings.bracketValidation,
    deghostConfidenceMapVisible: settings.deghostConfidenceMapVisible,
    deghostRegionIntensityPercent: settings.deghostRegionIntensityPercent,
    deghosting: settings.deghosting,
    maxPreviewDimensionPx: settings.maxPreviewDimensionPx,
    mergeStrategy: settings.mergeStrategy,
    outputName: 'HDR dry-run preview',
    qualityPreference: settings.qualityPreference,
    sources: sourcePaths.map((imagePath, sourceIndex) => ({
      exposureEv: [-2, 0, 2][sourceIndex] ?? 0,
      imagePath,
      sourceIndex,
    })),
    toneMapPreview: settings.toneMapPreview,
    toneMappingPreset: settings.toneMappingPreset,
  },
  {
    commandId: 'command_hdr_ui_action_boundary_dry_run',
    correlationId: 'corr_hdr_ui_action_boundary_dry_run',
    expectedGraphRevision: 'graph_rev_hdr_ui_action_boundary',
    targetId: 'project_hdr_ui',
  },
);

const { lastDryRunCommand, selectedPaths } = buildHdrDryRunActionState(sourcePaths, settings);
const lastApplyCommand = buildHdrApplyCommandState({ base64Length: 24, sourceCount: sourcePaths.length });

if (lastDryRunCommand.toolName !== routePair.dryRunToolName) {
  failures.push('HDR start action must store the typed app-server dry-run route.');
}
if (selectedPaths.join('|') !== sourcePaths.join('|')) {
  failures.push('HDR start action must use the selected source path set.');
}
if (lastDryRunCommand.sources !== packageCommand.parameters.sources.length) {
  failures.push('HDR UI action source count must match package command builder.');
}
if (packageCommand.parameters.sources.some((source) => source.role !== 'hdr_bracket')) {
  failures.push('Package HDR UI command sources must use hdr_bracket roles.');
}
if (settings.deghosting !== packageCommand.parameters.deghosting) {
  failures.push('HDR UI action deghosting must match package command builder.');
}
if (
  settings.deghostConfidenceMapVisible !== packageCommand.parameters.deghostConfidenceMapVisible ||
  settings.deghostRegionIntensityPercent !== packageCommand.parameters.deghostRegionIntensityPercent
) {
  failures.push('HDR UI action deghost confidence map controls must match package command builder.');
}
if (settings.mergeStrategy !== packageCommand.parameters.mergeStrategy) {
  failures.push('HDR UI action merge strategy must match package command builder.');
}
if (settings.toneMappingPreset !== packageCommand.parameters.toneMappingPreset) {
  failures.push('HDR UI action tone-mapping preset must match package command builder.');
}
if (lastApplyCommand.toolName !== routePair.applyToolName || lastApplyCommand.dryRun !== false) {
  failures.push('HDR complete listener must store mutating apply command metadata with the typed app-server route.');
}
if (lastApplyCommand.acceptedDryRunPlanHash !== 'sha256:hdr-preview-24') {
  failures.push('HDR apply command metadata must preserve the accepted dry-run hash.');
}

const staleState: HdrModalState = {
  ...createDefaultHdrModalState(settings),
  error: 'stale error',
  finalImageBase64: 'data:image/png;base64,stale',
  isProcessing: true,
  lastApplyCommand,
  lastDryRunCommand,
  progressMessage: 'stale progress',
  savedHandoffSummary: {
    capabilityLevel: 'editable_derived_output',
    deghostReviewAccepted: true,
    deghostReviewRequired: true,
    deghosting: 'medium',
    displayPreviewColorState: 'display_referred_srgb',
    editableDerivedAssetId: 'hdr-editable-stale',
    exportColorState: 'display_referred_srgb',
    mergeStrategy: 'scene_linear_radiance',
    outputColorSpace: 'srgb',
    outputEncoding: 'display_referred',
    outputPath: '/tmp/stale.tif',
    previewExportMeanAbsDelta: 0,
    previewExportParity: {
      comparedFields: ['outputPath'],
      exportReceiptHash: 'sha256:export',
      meanAbsDelta: 0,
      parityProofHash: 'sha256:proof',
      previewStateHash: 'sha256:preview',
    },
    previewExportParityStatus: 'matched',
    previewToneMapped: true,
    sceneMergeColorState: 'scene_linear',
    sourceCount: 3,
    sourceRefs: [],
    warningCodes: [],
    workingColorSpace: 'linear_rec2020',
  },
};
const resetState = resetHdrStateForSettingsChange(staleState, {
  ...settings,
  deghosting: 'high',
});

if (resetState.error !== null || resetState.finalImageBase64 !== null || resetState.progressMessage !== null) {
  failures.push('HDR settings changes must clear stale error/output/progress state.');
}
if ('lastDryRunCommand' in resetState || 'lastApplyCommand' in resetState) {
  failures.push('HDR settings changes must clear stale dry-run and apply command metadata.');
}
if (resetState.savedHandoffSummary !== null) {
  failures.push('HDR settings changes must clear stale editable handoff metadata.');
}

const dryRunAttrs = renderedAttrs(
  'hdr-dry-run-command-state',
  React.createElement(HdrModal, {
    error: null,
    finalImageBase64: null,
    imageCount: sourcePaths.length,
    isOpen: true,
    isProcessing: true,
    lastApplyCommand: undefined,
    lastDryRunCommand,
    onClose: noop,
    onMerge: noop,
    onOpenFile: noop,
    onSave: async () => '/tmp/hdr.tif',
    onSettingsChange: noop,
    progressMessage: 'Starting HDR',
    settings,
    sourcePaths,
  }),
);
assertAttr(dryRunAttrs, 'data-tool-name', routePair.dryRunToolName, 'HDR processing UI must render dry-run tool name.');
assertAttr(dryRunAttrs, 'data-source-count', '3', 'HDR processing UI must render dry-run source count.');
assertAttr(dryRunAttrs, 'data-dry-run', 'true', 'HDR processing UI must render dry-run mode.');

const applyAttrs = renderedAttrs(
  'hdr-apply-command-state',
  React.createElement(HdrModal, {
    error: null,
    finalImageBase64: 'data:image/png;base64,aGRyLXByZXZpZXc=',
    imageCount: sourcePaths.length,
    isOpen: true,
    isProcessing: false,
    lastApplyCommand,
    lastDryRunCommand,
    onClose: noop,
    onMerge: noop,
    onOpenFile: noop,
    onSave: async () => '/tmp/hdr.tif',
    onSettingsChange: noop,
    progressMessage: null,
    settings,
    sourcePaths,
  }),
);
assertAttr(applyAttrs, 'data-tool-name', routePair.applyToolName, 'HDR result UI must render apply tool name.');
assertAttr(
  applyAttrs,
  'data-accepted-dry-run-plan-hash',
  'sha256:hdr-preview-24',
  'HDR result UI must render accepted dry-run hash.',
);
assertAttr(applyAttrs, 'data-dry-run', 'false', 'HDR result UI must render mutating apply mode.');

const syntheticHdrImages = buildSyntheticHdrImages();
const expandedStack = findHdrAutoStackPaths(syntheticHdrImages, '/tmp/hdr-stack/_DSC7528.ARW');
const unrelatedImage = syntheticHdrImage(
  '/tmp/other-stack/zzzz.ARW',
  Date.parse('2026-01-01T00:00:01Z') / 1000,
  '2026:01:01 00:00:01',
  '1/250',
);
const fallbackStack = findHdrAutoStackPaths(
  [syntheticHdrImages[1], unrelatedImage, syntheticHdrImages[0], syntheticHdrImages[2]].filter(
    (image): image is ImageFile => image !== undefined,
  ),
  '/tmp/hdr-stack/_DSC7529.ARW',
);
if (expandedStack?.length !== 3 || !expandedStack.includes('/tmp/hdr-stack/_DSC7529.ARW')) {
  failures.push('HDR thumbnail action must expand a single bracket member to the full auto-stack source set.');
}
if (fallbackStack?.join('|') !== expandedStack?.join('|')) {
  failures.push('HDR thumbnail action must recover bracket stacks with the path-sorted fallback source selection.');
}
const hdrSourceMetadata = (expandedStack ?? []).map((path) => ({
  exif: syntheticHdrImages.find((image) => image.path === path)?.exif ?? null,
  path,
}));
if (hdrSourceMetadata.length !== 3 || hdrSourceMetadata.some((source) => source.exif === null)) {
  failures.push('HDR thumbnail action must pass expanded stack source metadata into the modal.');
}

if (failures.length > 0) {
  console.error('hdr UI action command failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`hdr UI action command ok (${lastDryRunCommand.toolName}, sources=${lastDryRunCommand.sources})`);

function renderedAttrs(testId: string, element: React.ReactElement): Record<string, string> {
  const html = renderToStaticMarkup(element);
  const match = html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`, 'u'));
  if (!match) {
    failures.push(`Rendered HDR modal missing ${testId}.`);
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

function buildSyntheticHdrImages(): ImageFile[] {
  const syntheticCaptureTime = Date.parse('2026-01-01T00:00:00Z') / 1000;
  return [
    syntheticHdrImage('/tmp/hdr-stack/_DSC7527.ARW', syntheticCaptureTime, '2026:01:01 00:00:00', '1/1000'),
    syntheticHdrImage('/tmp/hdr-stack/_DSC7528.ARW', syntheticCaptureTime + 1, '2026:01:01 00:00:01', '1/250'),
    syntheticHdrImage('/tmp/hdr-stack/_DSC7529.ARW', syntheticCaptureTime + 2, '2026:01:01 00:00:02', '1/60'),
  ];
}

function syntheticHdrImage(path: string, modified: number, dateTimeOriginal: string, exposureTime: string): ImageFile {
  return {
    exif: {
      DateTimeOriginal: dateTimeOriginal,
      ExposureTime: exposureTime,
      FNumber: '8',
      FocalLength: '35',
      ISO: '100',
      LensModel: 'Test 35mm',
      Make: 'Sony',
      Model: 'ILCE-7M4',
    },
    is_edited: false,
    is_virtual_copy: false,
    modified,
    path,
    rating: 0,
    tags: null,
  };
}
