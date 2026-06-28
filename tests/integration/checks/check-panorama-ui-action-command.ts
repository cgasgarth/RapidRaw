#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { buildPanoramaUiDryRunCommandV1 } from '../../../packages/rawengine-schema/src/panoramaUiControls.ts';
import { DEFAULT_PANORAMA_UI_SETTINGS } from '../../../src/schemas/panoramaUiSchemas.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';

const actionMetadataSchema = z
  .object({
    appServerToolName: z.literal(getComputationalMergeAppServerRoutePairSummary('panorama').dryRunToolName),
    boundaryMode: z.literal('auto_crop'),
    commandType: z.literal('computationalMerge.createPanorama'),
    dryRun: z.literal(true),
    maxPreviewDimensionPx: z.number().int().positive(),
    projection: z.literal('rectilinear'),
    sourceCount: z.number().int().min(2),
  })
  .strict();
const applyActionMetadataSchema = z
  .object({
    acceptedDryRunPlanHash: z.string().trim().min(1),
    acceptedDryRunPlanId: z.string().trim().min(1),
    commandType: z.literal('computationalMerge.createPanorama'),
    dryRun: z.literal(false),
    sourceCount: z.number().int().min(2),
    toolName: z.literal(getComputationalMergeAppServerRoutePairSummary('panorama').applyToolName),
  })
  .strict();

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
const routePair = getComputationalMergeAppServerRoutePairSummary('panorama');
const packageCommand = buildPanoramaUiDryRunCommandV1(
  {
    blendMode: settings.blendMode,
    boundaryMode: settings.boundaryMode,
    exposureMode: settings.exposureMode,
    maxPreviewDimensionPx: settings.maxPreviewDimensionPx,
    outputName: 'Panorama dry-run preview',
    projection: settings.projection,
    qualityPreference: settings.qualityPreference,
    sources: sourcePaths.map((imagePath, sourceIndex) => ({
      imagePath,
      sourceIndex,
    })),
  },
  {
    commandId: 'command_panorama_ui_action_boundary_dry_run',
    correlationId: 'corr_panorama_ui_action_boundary_dry_run',
    expectedGraphRevision: 'graph_rev_panorama_ui_action_boundary',
    targetId: 'project_panorama_ui',
  },
);
const actionMetadata = actionMetadataSchema.parse({
  appServerToolName: routePair.dryRunToolName,
  boundaryMode: settings.boundaryMode,
  commandType: packageCommand.commandType,
  dryRun: packageCommand.dryRun,
  maxPreviewDimensionPx: settings.maxPreviewDimensionPx,
  projection: settings.projection,
  sourceCount: packageCommand.parameters.sources.length,
});
const applyActionMetadata = applyActionMetadataSchema.parse({
  acceptedDryRunPlanHash: 'sha256:panorama-preview-plan',
  acceptedDryRunPlanId: 'panorama_plan_3',
  commandType: packageCommand.commandType,
  dryRun: false,
  sourceCount: packageCommand.parameters.sources.length,
  toolName: routePair.applyToolName,
});
const [productivityActionsSource, appModalsSource, panoramaModalSource, tauriListenersSource] = await Promise.all([
  readFile('src/hooks/useProductivityActions.ts', 'utf8'),
  readFile('src/components/modals/AppModals.tsx', 'utf8'),
  readFile('src/components/modals/PanoramaModal.tsx', 'utf8'),
  readFile('src/hooks/useTauriListeners.ts', 'utf8'),
]);
const failures: string[] = [];

if (!productivityActionsSource.includes("getComputationalMergeAppServerRoutePairSummary('panorama').dryRunToolName")) {
  failures.push('Panorama start action must store the typed app-server dry-run route.');
}
if (!productivityActionsSource.includes('lastDryRunCommand: dryRunCommand')) {
  failures.push('Panorama start action must persist dry-run command metadata.');
}
if (!productivityActionsSource.includes('lastApplyCommand: null')) {
  failures.push('Panorama start action must clear stale apply command metadata.');
}
if (!appModalsSource.includes('lastDryRunCommand={panoramaModalState.lastDryRunCommand}')) {
  failures.push('AppModals must pass panorama dry-run command metadata into PanoramaModal.');
}
if (!appModalsSource.includes('lastApplyCommand={panoramaModalState.lastApplyCommand}')) {
  failures.push('AppModals must pass panorama apply command metadata into PanoramaModal.');
}
if (!panoramaModalSource.includes('data-testid="panorama-dry-run-command-state"')) {
  failures.push('Panorama processing UI must render dry-run command state.');
}
if (!panoramaModalSource.includes('data-tool-name={lastDryRunCommand.appServerToolName}')) {
  failures.push('Panorama processing UI must expose the dry-run tool name.');
}
if (!panoramaModalSource.includes('data-testid="panorama-apply-command-state"')) {
  failures.push('Panorama result UI must render apply command state.');
}
if (!panoramaModalSource.includes('data-accepted-dry-run-plan-hash={lastApplyCommand.acceptedDryRunPlanHash}')) {
  failures.push('Panorama apply command state must expose accepted dry-run hash.');
}
if (!tauriListenersSource.includes("getComputationalMergeAppServerRoutePairSummary('panorama').applyToolName")) {
  failures.push('Panorama complete listener must store the typed app-server apply route.');
}
if (!tauriListenersSource.includes('lastApplyCommand:')) {
  failures.push('Panorama complete listener must persist apply command metadata.');
}
for (const marker of [
  'boundaryMode: settings.boundaryMode',
  'projection: settings.projection',
  'maxPreviewDimensionPx',
]) {
  if (!productivityActionsSource.includes(marker)) {
    failures.push(`Panorama start action must persist runtime setting marker: ${marker}`);
  }
}
if (actionMetadata.appServerToolName !== routePair.dryRunToolName) {
  failures.push('Panorama UI action command must use the typed app-server dry-run route.');
}
if (applyActionMetadata.toolName !== routePair.applyToolName) {
  failures.push('Panorama UI action command must use the typed app-server apply route.');
}
if (actionMetadata.commandType !== packageCommand.commandType) {
  failures.push('Panorama UI action command type must match package command builder.');
}
if (actionMetadata.dryRun !== true || packageCommand.dryRun !== true) {
  failures.push('Panorama UI action command must be dry-run only.');
}
if (applyActionMetadata.dryRun !== false) {
  failures.push('Panorama apply command metadata must be mutating.');
}
if (actionMetadata.sourceCount !== packageCommand.parameters.sources.length) {
  failures.push('Panorama UI action source count must match package command builder.');
}
if (applyActionMetadata.sourceCount !== packageCommand.parameters.sources.length) {
  failures.push('Panorama apply command source count must match package command builder.');
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
if (actionMetadata.projection !== 'rectilinear' || actionMetadata.boundaryMode !== 'auto_crop') {
  failures.push('Panorama UI action must use runtime-supported rectilinear auto-crop defaults.');
}
if ('none' !== packageCommand.parameters.exposureNormalization) {
  failures.push('Panorama UI action exposure normalization must match package command builder.');
}

if (failures.length > 0) {
  console.error('panorama UI action command failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `panorama UI action command ok (${actionMetadata.appServerToolName}, sources=${actionMetadata.sourceCount})`,
);
