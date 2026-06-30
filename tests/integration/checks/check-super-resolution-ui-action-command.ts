#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { buildSuperResolutionUiDryRunCommandV1 } from '../../../packages/rawengine-schema/src/superResolutionUiControls.ts';
import { DEFAULT_SUPER_RESOLUTION_UI_SETTINGS } from '../../../src/schemas/superResolutionUiSchemas.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computational-merge/computationalMergeAppServerRoutePairs.ts';

const actionMetadataSchema = z
  .object({
    commandType: z.literal('computationalMerge.createSuperResolution'),
    dryRun: z.literal(true),
    sources: z.number().int().min(2),
    toolName: z.literal(getComputationalMergeAppServerRoutePairSummary('super_resolution').dryRunToolName),
  })
  .strict();
const applyActionMetadataSchema = z
  .object({
    acceptedDryRunPlanHash: z.string().trim().min(1),
    acceptedDryRunPlanId: z.string().trim().min(1),
    commandType: z.literal('computationalMerge.createSuperResolution'),
    dryRun: z.literal(false),
    sources: z.number().int().min(2),
    toolName: z.literal(getComputationalMergeAppServerRoutePairSummary('super_resolution').applyToolName),
  })
  .strict();

const sourcePaths = [
  '/private-fixtures/super-resolution/alaska-burst-v1/_DSC7861.ARW',
  '/private-fixtures/super-resolution/alaska-burst-v1/_DSC7862.ARW',
  '/private-fixtures/super-resolution/alaska-burst-v1/_DSC7863.ARW',
  '/private-fixtures/super-resolution/alaska-burst-v1/_DSC7864.ARW',
];
const settings = {
  ...DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
  alignmentMode: 'translation',
  detailPolicy: 'balanced',
  maxPreviewDimensionPx: 4096,
  outputScale: 2,
  qualityPreference: 'balanced',
  reconstructionMode: 'optical_flow',
} as const;
const routePair = getComputationalMergeAppServerRoutePairSummary('super_resolution');
const packageCommand = buildSuperResolutionUiDryRunCommandV1(
  {
    alignmentMode: settings.alignmentMode,
    detailPolicy: settings.detailPolicy,
    maxPreviewDimensionPx: settings.maxPreviewDimensionPx,
    outputName: 'Super-resolution dry-run preview',
    outputScale: settings.outputScale,
    qualityPreference: settings.qualityPreference,
    reconstructionMode: settings.reconstructionMode,
    sources: sourcePaths.map((imagePath, sourceIndex) => ({
      imagePath,
      sourceIndex,
    })),
  },
  {
    commandId: 'command_sr_ui_action_boundary_dry_run',
    correlationId: 'corr_sr_ui_action_boundary_dry_run',
    expectedGraphRevision: 'graph_rev_sr_ui_action_boundary',
    targetId: 'project_sr_ui',
  },
);
const actionMetadata = actionMetadataSchema.parse({
  commandType: packageCommand.commandType,
  dryRun: packageCommand.dryRun,
  sources: packageCommand.parameters.sources.length,
  toolName: routePair.dryRunToolName,
});
const applyActionMetadata = applyActionMetadataSchema.parse({
  acceptedDryRunPlanHash: 'sha256:super-resolution-preview-plan',
  acceptedDryRunPlanId: 'super_resolution_plan_4',
  commandType: packageCommand.commandType,
  dryRun: false,
  sources: packageCommand.parameters.sources.length,
  toolName: routePair.applyToolName,
});
const [modalSource, appModalsSource] = await Promise.all([
  readFile('src/components/modals/computational-merge/SuperResolutionModal.tsx', 'utf8'),
  readFile('src/components/modals/AppModals.tsx', 'utf8'),
]);
const failures: string[] = [];

if (!modalSource.includes('onPreviewPlan')) {
  failures.push('Super-resolution modal must expose a preview-plan action callback.');
}
if (!modalSource.includes('disabled={!isSourceCountValid}')) {
  failures.push('Super-resolution preview-plan action must stay source-count gated.');
}
if (!modalSource.includes('previewPlanStatusLabel')) {
  failures.push('Super-resolution modal must expose visible preview-plan status.');
}
if (!modalSource.includes('modals.superResolution.refreshPreviewPlan')) {
  failures.push('Super-resolution modal must show a refreshed action label after preview generation.');
}
if (!appModalsSource.includes("getComputationalMergeAppServerRoutePairSummary('super_resolution').dryRunToolName")) {
  failures.push('Super-resolution preview-plan action must store the typed app-server dry-run route.');
}
if (!appModalsSource.includes('lastDryRunCommand')) {
  failures.push('Super-resolution preview-plan action must persist dry-run command metadata.');
}
if (!appModalsSource.includes('lastDryRunCommand={superResolutionModalState.lastDryRunCommand}')) {
  failures.push('AppModals must pass super-resolution dry-run command metadata into SuperResolutionModal.');
}
if (!appModalsSource.includes('lastDryRunCommand: _lastDryRunCommand')) {
  failures.push('Super-resolution settings changes must clear stale dry-run command metadata.');
}
if (!modalSource.includes('data-testid="sr-dry-run-command-state"')) {
  failures.push('Super-resolution modal must render dry-run command state.');
}
if (!modalSource.includes('onApplyPlan')) {
  failures.push('Super-resolution modal must expose an apply-plan action callback.');
}
if (!modalSource.includes('disabled={!isApplyPlanReady}')) {
  failures.push('Super-resolution apply-plan action must stay preview/preflight gated.');
}
if (!modalSource.includes("outputReview.decision !== 'preview_only'")) {
  failures.push('Super-resolution apply-plan readiness must reject preview-only decisions.');
}
if (!modalSource.includes('data-testid="sr-apply-command-state"')) {
  failures.push('Super-resolution modal must render apply command state.');
}
if (!modalSource.includes('data-accepted-dry-run-plan-hash={lastApplyCommand.acceptedDryRunPlanHash}')) {
  failures.push('Super-resolution apply command state must expose accepted dry-run hash.');
}
if (!modalSource.includes('data-tool-name={lastDryRunCommand.toolName}')) {
  failures.push('Super-resolution modal must expose the dry-run tool name.');
}
if (!appModalsSource.includes('routePair.applyToolName')) {
  failures.push('Super-resolution apply-plan action must store the typed app-server apply route.');
}
if (!appModalsSource.includes('lastApplyCommand')) {
  failures.push('Super-resolution apply-plan action must persist apply command metadata.');
}
if (!appModalsSource.includes('lastApplyCommand={superResolutionModalState.lastApplyCommand}')) {
  failures.push('AppModals must pass super-resolution apply command metadata into SuperResolutionModal.');
}
if (!appModalsSource.includes("editableGate: 'ready'")) {
  failures.push('Super-resolution apply-plan action must update editable gate to ready.');
}
if (!appModalsSource.includes("reviewStatus: 'apply_ready'")) {
  failures.push('Super-resolution apply-plan action must update support map review status to apply_ready.');
}
if (!appModalsSource.includes('buildSuperResolutionOutputReviewWorkflow')) {
  failures.push('Super-resolution preview-plan action must materialize a visible output review.');
}
if (!appModalsSource.includes('outputReview: buildSuperResolutionOutputReviewWorkflow')) {
  failures.push('Super-resolution preview-plan action must update outputReview instead of leaving the UI unchanged.');
}
if (actionMetadata.toolName !== routePair.dryRunToolName) {
  failures.push('Super-resolution UI action command must use the typed app-server dry-run route.');
}
if (applyActionMetadata.toolName !== routePair.applyToolName) {
  failures.push('Super-resolution UI action command must use the typed app-server apply route.');
}
if (actionMetadata.commandType !== packageCommand.commandType) {
  failures.push('Super-resolution UI action command type must match package command builder.');
}
if (actionMetadata.dryRun !== true || packageCommand.dryRun !== true) {
  failures.push('Super-resolution UI action command must be dry-run only.');
}
if (applyActionMetadata.dryRun !== false) {
  failures.push('Super-resolution apply command metadata must be mutating.');
}
if (actionMetadata.sources !== packageCommand.parameters.sources.length) {
  failures.push('Super-resolution UI action source count must match package command builder.');
}
if (applyActionMetadata.sources !== packageCommand.parameters.sources.length) {
  failures.push('Super-resolution apply command source count must match package command builder.');
}
if (packageCommand.parameters.sources.some((source) => source.role !== 'sr_frame')) {
  failures.push('Package super-resolution UI command sources must use sr_frame roles.');
}
if (settings.outputScale !== packageCommand.parameters.outputScale) {
  failures.push('Super-resolution UI action scale must match package command builder.');
}
if (settings.detailPolicy !== packageCommand.parameters.detailPolicy) {
  failures.push('Super-resolution UI action detail policy must match package command builder.');
}
if (settings.reconstructionMode !== packageCommand.parameters.reconstructionMode) {
  failures.push('Super-resolution UI action reconstruction mode must match package command builder.');
}

if (failures.length > 0) {
  console.error('super-resolution UI action command failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`super-resolution UI action command ok (${actionMetadata.toolName}, sources=${actionMetadata.sources})`);
