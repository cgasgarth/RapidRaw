#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { buildHdrMergeUiDryRunCommandV1 } from '../../../packages/rawengine-schema/src/hdrMergeUiControls.ts';
import { DEFAULT_HDR_MERGE_UI_SETTINGS } from '../../../src/schemas/hdrMergeUiSchemas.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';
import { buildLibraryAutoStacks } from '../../../src/utils/libraryAutoStacks.ts';

import type { ImageFile } from '../../../src/components/ui/AppProperties.tsx';

const actionMetadataSchema = z
  .object({
    toolName: z.literal(getComputationalMergeAppServerRoutePairSummary('hdr').dryRunToolName),
    commandType: z.literal('computationalMerge.createHdr'),
    dryRun: z.literal(true),
    sources: z.number().int().min(2),
  })
  .strict();
const applyActionMetadataSchema = z
  .object({
    acceptedDryRunPlanHash: z.string().trim().min(1),
    acceptedDryRunPlanId: z.string().trim().min(1),
    commandType: z.literal('computationalMerge.createHdr'),
    dryRun: z.literal(false),
    sources: z.number().int().min(2),
    toolName: z.literal(getComputationalMergeAppServerRoutePairSummary('hdr').applyToolName),
  })
  .strict();

const sourcePaths = [
  '/private-fixtures/hdr/bracket-alignment-v1/frame-01-under.arw',
  '/private-fixtures/hdr/bracket-alignment-v1/frame-02-mid.arw',
  '/private-fixtures/hdr/bracket-alignment-v1/frame-03-over.arw',
];
const exposureEvs = [-2, 0, 2] as const;
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
  toneMapPreview: true,
  toneMappingPreset: 'highlight_detail',
} as const;
const routePair = getComputationalMergeAppServerRoutePairSummary('hdr');
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
      exposureEv: exposureEvs[sourceIndex] ?? 0,
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
const actionMetadata = actionMetadataSchema.parse({
  toolName: routePair.dryRunToolName,
  commandType: packageCommand.commandType,
  dryRun: packageCommand.dryRun,
  sources: packageCommand.parameters.sources.length,
});
const applyActionMetadata = applyActionMetadataSchema.parse({
  acceptedDryRunPlanHash: 'sha256:hdr-preview-plan',
  acceptedDryRunPlanId: 'hdr_plan_3',
  commandType: packageCommand.commandType,
  dryRun: false,
  sources: packageCommand.parameters.sources.length,
  toolName: routePair.applyToolName,
});
const [appModalsSource, contextMenuSource, hdrModalSource, productivityActionsSource, tauriListenersSource] =
  await Promise.all([
    readFile('src/components/modals/AppModals.tsx', 'utf8'),
    readFile('src/hooks/useAppContextMenus.ts', 'utf8'),
    readFile('src/components/modals/HdrModal.tsx', 'utf8'),
    readFile('src/hooks/useProductivityActions.ts', 'utf8'),
    readFile('src/hooks/useTauriListeners.ts', 'utf8'),
  ]);
const failures: string[] = [];
const syntheticCaptureTime = Date.parse('2026-01-01T00:00:00Z') / 1000;
const syntheticHdrImages: ImageFile[] = [
  {
    is_edited: false,
    is_virtual_copy: false,
    modified: syntheticCaptureTime,
    path: '/tmp/hdr-stack/_DSC7527.ARW',
    rating: 0,
    tags: null,
    exif: {
      DateTimeOriginal: '2026:01:01 00:00:00',
      ExposureTime: '1/1000',
      FNumber: '8',
      FocalLength: '35',
      ISO: '100',
      LensModel: 'Test 35mm',
      Make: 'Sony',
      Model: 'ILCE-7M4',
    },
  },
  {
    is_edited: false,
    is_virtual_copy: false,
    modified: syntheticCaptureTime + 1,
    path: '/tmp/hdr-stack/_DSC7528.ARW',
    rating: 0,
    tags: null,
    exif: {
      DateTimeOriginal: '2026:01:01 00:00:01',
      ExposureTime: '1/250',
      FNumber: '8',
      FocalLength: '35',
      ISO: '100',
      LensModel: 'Test 35mm',
      Make: 'Sony',
      Model: 'ILCE-7M4',
    },
  },
  {
    is_edited: false,
    is_virtual_copy: false,
    modified: syntheticCaptureTime + 2,
    path: '/tmp/hdr-stack/_DSC7529.ARW',
    rating: 0,
    tags: null,
    exif: {
      DateTimeOriginal: '2026:01:01 00:00:02',
      ExposureTime: '1/60',
      FNumber: '8',
      FocalLength: '35',
      ISO: '100',
      LensModel: 'Test 35mm',
      Make: 'Sony',
      Model: 'ILCE-7M4',
    },
  },
];
const syntheticHdrStack = buildLibraryAutoStacks(syntheticHdrImages).find((stack) => stack.kind === 'bracket');
const syntheticPathSortedHdrStack = buildLibraryAutoStacks(
  [syntheticHdrImages[1], syntheticHdrImages[2], syntheticHdrImages[0]]
    .filter((image): image is ImageFile => Boolean(image))
    .toSorted((left, right) => left.path.localeCompare(right.path)),
).find((stack) => stack.kind === 'bracket');

if (!productivityActionsSource.includes("getComputationalMergeAppServerRoutePairSummary('hdr').dryRunToolName")) {
  failures.push('HDR start action must store the typed app-server dry-run route.');
}
if (!productivityActionsSource.includes('lastDryRunCommand: dryRunCommand')) {
  failures.push('HDR start action must persist dry-run command metadata.');
}
if (!productivityActionsSource.includes('lastApplyCommand: _lastApplyCommand')) {
  failures.push('HDR start action must clear stale apply command metadata.');
}
if (!appModalsSource.includes('lastDryRunCommand={hdrModalState.lastDryRunCommand}')) {
  failures.push('AppModals must pass HDR dry-run command metadata into the modal.');
}
if (!appModalsSource.includes('lastApplyCommand={hdrModalState.lastApplyCommand}')) {
  failures.push('AppModals must pass HDR apply command metadata into the modal.');
}
const hdrSettingsHandlerMatch = appModalsSource.match(
  /<HdrModal[\s\S]*?onSettingsChange=\{\(settings\) => \{(?<handler>[\s\S]*?)\}\}\s*progressMessage=/u,
);
const hdrSettingsHandler = hdrSettingsHandlerMatch?.groups?.handler ?? '';
if (!hdrSettingsHandler.includes('error: null')) {
  failures.push('HDR settings changes must clear stale error state.');
}
if (!hdrSettingsHandler.includes('finalImageBase64: null')) {
  failures.push('HDR settings changes must clear stale rendered output previews.');
}
if (!hdrSettingsHandler.includes('lastDryRunCommand: _lastDryRunCommand')) {
  failures.push('HDR settings changes must clear stale dry-run command metadata.');
}
if (!hdrSettingsHandler.includes('lastApplyCommand: _lastApplyCommand')) {
  failures.push('HDR settings changes must clear stale apply command metadata.');
}
if (!hdrSettingsHandler.includes('progressMessage: null')) {
  failures.push('HDR settings changes must clear stale progress text.');
}
if (!hdrModalSource.includes('data-testid="hdr-dry-run-command-state"')) {
  failures.push('HDR processing view must render the dry-run command state.');
}
if (!hdrModalSource.includes('data-tool-name={lastDryRunCommand.toolName}')) {
  failures.push('HDR dry-run command state must expose the app-server tool name.');
}
if (!hdrModalSource.includes('data-testid="hdr-apply-command-state"')) {
  failures.push('HDR result view must render apply command state.');
}
if (!hdrModalSource.includes('data-accepted-dry-run-plan-hash={lastApplyCommand.acceptedDryRunPlanHash}')) {
  failures.push('HDR apply command state must expose accepted dry-run hash.');
}
if (!tauriListenersSource.includes("getComputationalMergeAppServerRoutePairSummary('hdr').applyToolName")) {
  failures.push('HDR complete listener must store the typed app-server apply route.');
}
if (!tauriListenersSource.includes('lastApplyCommand:')) {
  failures.push('HDR complete listener must persist apply command metadata.');
}
if (!contextMenuSource.includes('findHdrAutoStackPaths')) {
  failures.push('Thumbnail context menu must inspect library auto-stacks for HDR source expansion.');
}
if (!contextMenuSource.includes('left.path.localeCompare(right.path)')) {
  failures.push('Thumbnail context menu must fall back to path-sorted HDR stack detection.');
}
if (!contextMenuSource.includes('const hdrSelectionCount = hdrStackSelection.length')) {
  failures.push('Thumbnail context menu must gate HDR availability on expanded HDR stack source count.');
}
if (!contextMenuSource.includes('sourceMetadata: hdrSourceMetadata')) {
  failures.push('Thumbnail context menu must pass HDR stack source metadata into the modal.');
}
if (!contextMenuSource.includes('stitchingSourcePaths: hdrStackSelection')) {
  failures.push('Thumbnail context menu must open HDR modal with the full HDR stack source set.');
}
if (syntheticHdrStack?.coverPath !== '/tmp/hdr-stack/_DSC7528.ARW' || syntheticHdrStack.paths.length !== 3) {
  failures.push('Synthetic HDR auto-stack fixture should resolve to a three-frame bracket stack.');
}
if (!syntheticHdrStack?.paths.includes('/tmp/hdr-stack/_DSC7529.ARW')) {
  failures.push('Synthetic HDR auto-stack fixture should preserve all bracket member paths.');
}
if (syntheticPathSortedHdrStack?.paths.length !== 3) {
  failures.push('Path-sorted HDR auto-stack fixture should recover bracket stacks from unsorted store order.');
}
if (actionMetadata.toolName !== routePair.dryRunToolName) {
  failures.push('HDR UI action command must use the typed app-server dry-run route.');
}
if (applyActionMetadata.toolName !== routePair.applyToolName) {
  failures.push('HDR UI action command must use the typed app-server apply route.');
}
if (actionMetadata.commandType !== packageCommand.commandType) {
  failures.push('HDR UI action command type must match package command builder.');
}
if (actionMetadata.dryRun !== true || packageCommand.dryRun !== true) {
  failures.push('HDR UI action command must be dry-run only.');
}
if (applyActionMetadata.dryRun !== false) {
  failures.push('HDR apply command metadata must be mutating.');
}
if (actionMetadata.sources !== packageCommand.parameters.sources.length) {
  failures.push('HDR UI action source count must match package command builder.');
}
if (applyActionMetadata.sources !== packageCommand.parameters.sources.length) {
  failures.push('HDR apply command source count must match package command builder.');
}
if (packageCommand.parameters.sources.some((source) => source.role !== 'hdr_bracket')) {
  failures.push('Package HDR UI command sources must use hdr_bracket roles.');
}
if (settings.alignmentMode !== packageCommand.parameters.alignmentMode) {
  failures.push('HDR UI action alignment must match package command builder.');
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

if (failures.length > 0) {
  console.error('hdr UI action command failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`hdr UI action command ok (${actionMetadata.toolName}, sources=${actionMetadata.sources})`);
