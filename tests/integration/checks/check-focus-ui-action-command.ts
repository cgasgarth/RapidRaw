#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { buildFocusStackUiDryRunCommandV1 } from '../../../packages/rawengine-schema/src/focusStackUiControls.ts';
import { DEFAULT_FOCUS_STACK_UI_SETTINGS } from '../../../src/schemas/focusStackUiSchemas.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';

const actionMetadataSchema = z
  .object({
    commandType: z.literal('computationalMerge.createFocusStack'),
    dryRun: z.literal(true),
    haloSuppressionStrengthPercent: z.literal(80),
    sources: z.number().int().min(2),
    toolName: z.literal(getComputationalMergeAppServerRoutePairSummary('focus_stack').dryRunToolName),
  })
  .strict();

const sourcePaths = [
  '/private-fixtures/focus-stack/alaska-plane-v1/_DSC7509.ARW',
  '/private-fixtures/focus-stack/alaska-plane-v1/_DSC7510.ARW',
  '/private-fixtures/focus-stack/alaska-plane-v1/_DSC7511.ARW',
];
const settings = {
  ...DEFAULT_FOCUS_STACK_UI_SETTINGS,
  alignmentMode: 'translation',
  blendMethod: 'weighted_sharpness',
  haloSuppressionStrengthPercent: 80,
  maxPreviewDimensionPx: 4096,
  qualityPreference: 'balanced',
  retouchLayerPolicy: 'generate_retouch_layer',
} as const;
const routePair = getComputationalMergeAppServerRoutePairSummary('focus_stack');
const packageCommand = buildFocusStackUiDryRunCommandV1(
  {
    alignmentMode: settings.alignmentMode,
    blendMethod: settings.blendMethod,
    haloSuppressionStrengthPercent: settings.haloSuppressionStrengthPercent,
    maxPreviewDimensionPx: settings.maxPreviewDimensionPx,
    outputName: 'Focus stack dry-run preview',
    qualityPreference: settings.qualityPreference,
    retouchLayerPolicy: settings.retouchLayerPolicy,
    sources: sourcePaths.map((imagePath, sourceIndex) => ({
      focusDistanceMm: 100 + sourceIndex * 50,
      imagePath,
      sourceIndex,
    })),
  },
  {
    commandId: 'command_focus_stack_ui_action_boundary_dry_run',
    correlationId: 'corr_focus_stack_ui_action_boundary_dry_run',
    expectedGraphRevision: 'graph_rev_focus_stack_ui_action_boundary',
    targetId: 'project_focus_stack_ui',
  },
);
const actionMetadata = actionMetadataSchema.parse({
  commandType: packageCommand.commandType,
  dryRun: packageCommand.dryRun,
  haloSuppressionStrengthPercent: packageCommand.parameters.haloSuppressionStrengthPercent,
  sources: packageCommand.parameters.sources.length,
  toolName: routePair.dryRunToolName,
});
const [modalSource, appModalsSource] = await Promise.all([
  readFile('src/components/modals/FocusStackModal.tsx', 'utf8'),
  readFile('src/components/modals/AppModals.tsx', 'utf8'),
]);
const failures: string[] = [];

if (!modalSource.includes('onPreviewPlan')) {
  failures.push('Focus stack modal must expose a preview-plan action callback.');
}
if (!modalSource.includes('disabled={!isSourceCountValid}')) {
  failures.push('Focus stack preview-plan action must stay source-count gated.');
}
if (!modalSource.includes('previewPlanStatusLabel')) {
  failures.push('Focus stack modal must show explicit preview-plan state.');
}
if (!modalSource.includes("t('modals.focusStack.refreshPreviewPlan')")) {
  failures.push('Focus stack modal must change Preview plan to Refresh plan after review state exists.');
}
if (!appModalsSource.includes("getComputationalMergeAppServerRoutePairSummary('focus_stack').dryRunToolName")) {
  failures.push('Focus stack preview-plan action must store the typed app-server dry-run route.');
}
if (!appModalsSource.includes('lastDryRunCommand')) {
  failures.push('Focus stack preview-plan action must persist dry-run command metadata.');
}
if (!appModalsSource.includes('lastDryRunCommand={focusStackModalState.lastDryRunCommand}')) {
  failures.push('AppModals must pass focus-stack dry-run command metadata into FocusStackModal.');
}
if (!appModalsSource.includes('sourcePreflightMetadata={focusStackModalState.sourcePreflightMetadata}')) {
  failures.push('AppModals must pass focus-stack source preflight metadata into FocusStackModal.');
}
if (!appModalsSource.includes('lastDryRunCommand: _lastDryRunCommand')) {
  failures.push('Focus stack settings changes must clear stale dry-run command metadata.');
}
if (!modalSource.includes('data-testid="focus-stack-source-preflight"')) {
  failures.push('Focus stack modal must render source preflight readiness.');
}
if (!modalSource.includes('data-testid="focus-dry-run-command-state"')) {
  failures.push('Focus stack modal must render dry-run command state.');
}
if (!modalSource.includes('data-tool-name={lastDryRunCommand.toolName}')) {
  failures.push('Focus stack modal must expose the dry-run tool name.');
}
if (!appModalsSource.includes('outputReview: buildFocusStackOutputReviewWorkflow')) {
  failures.push('Focus stack preview-plan action must update outputReview instead of leaving the UI unchanged.');
}
if (
  !appModalsSource.includes(
    'haloSuppressionStrengthPercent: focusStackModalState.settings.haloSuppressionStrengthPercent',
  )
) {
  failures.push('Focus stack preview-plan action must persist halo suppression metadata.');
}
if (actionMetadata.toolName !== routePair.dryRunToolName) {
  failures.push('Focus stack UI action command must use the typed app-server dry-run route.');
}
if (actionMetadata.commandType !== packageCommand.commandType) {
  failures.push('Focus stack UI action command type must match package command builder.');
}
if (actionMetadata.dryRun !== true || packageCommand.dryRun !== true) {
  failures.push('Focus stack UI action command must be dry-run only.');
}
if (actionMetadata.sources !== packageCommand.parameters.sources.length) {
  failures.push('Focus stack UI action source count must match package command builder.');
}
if (packageCommand.parameters.sources.some((source) => source.role !== 'focus_slice')) {
  failures.push('Package focus stack UI command sources must use focus_slice roles.');
}
if (settings.blendMethod !== packageCommand.parameters.blendMethod) {
  failures.push('Focus stack UI action blend method must match package command builder.');
}
if (settings.haloSuppressionStrengthPercent !== packageCommand.parameters.haloSuppressionStrengthPercent) {
  failures.push('Focus stack UI action halo suppression must match package command builder.');
}
if (settings.retouchLayerPolicy !== packageCommand.parameters.retouchLayerPolicy) {
  failures.push('Focus stack UI action retouch policy must match package command builder.');
}

if (failures.length > 0) {
  console.error('focus stack UI action command failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`focus stack UI action command ok (${actionMetadata.toolName}, sources=${actionMetadata.sources})`);
