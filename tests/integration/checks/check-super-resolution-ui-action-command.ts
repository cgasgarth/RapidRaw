#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { buildSuperResolutionUiDryRunCommandV1 } from '../../../packages/rawengine-schema/src/superResolutionUiControls.ts';
import { DEFAULT_SUPER_RESOLUTION_UI_SETTINGS } from '../../../src/schemas/superResolutionUiSchemas.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';

const actionMetadataSchema = z
  .object({
    commandType: z.literal('computationalMerge.createSuperResolution'),
    dryRun: z.literal(true),
    sources: z.number().int().min(2),
    toolName: z.literal(getComputationalMergeAppServerRoutePairSummary('super_resolution').dryRunToolName),
  })
  .strict();

const sourcePaths = [
  '/private-fixtures/super-resolution/subpixel-detail-v1/frame-01.nef',
  '/private-fixtures/super-resolution/subpixel-detail-v1/frame-02.nef',
  '/private-fixtures/super-resolution/subpixel-detail-v1/frame-03.nef',
  '/private-fixtures/super-resolution/subpixel-detail-v1/frame-04.nef',
];
const settings = {
  ...DEFAULT_SUPER_RESOLUTION_UI_SETTINGS,
  alignmentMode: 'translation',
  detailPolicy: 'balanced',
  maxPreviewDimensionPx: 4096,
  outputScale: 2,
  qualityPreference: 'balanced',
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
const [modalSource, appModalsSource] = await Promise.all([
  readFile('src/components/modals/SuperResolutionModal.tsx', 'utf8'),
  readFile('src/components/modals/AppModals.tsx', 'utf8'),
]);
const failures: string[] = [];

if (!modalSource.includes('onPreviewPlan')) {
  failures.push('Super-resolution modal must expose a preview-plan action callback.');
}
if (!modalSource.includes('disabled={!isSourceCountValid}')) {
  failures.push('Super-resolution preview-plan action must stay source-count gated.');
}
if (!appModalsSource.includes("getComputationalMergeAppServerRoutePairSummary('super_resolution').dryRunToolName")) {
  failures.push('Super-resolution preview-plan action must store the typed app-server dry-run route.');
}
if (!appModalsSource.includes('lastDryRunCommand')) {
  failures.push('Super-resolution preview-plan action must persist dry-run command metadata.');
}
if (actionMetadata.toolName !== routePair.dryRunToolName) {
  failures.push('Super-resolution UI action command must use the typed app-server dry-run route.');
}
if (actionMetadata.commandType !== packageCommand.commandType) {
  failures.push('Super-resolution UI action command type must match package command builder.');
}
if (actionMetadata.dryRun !== true || packageCommand.dryRun !== true) {
  failures.push('Super-resolution UI action command must be dry-run only.');
}
if (actionMetadata.sources !== packageCommand.parameters.sources.length) {
  failures.push('Super-resolution UI action source count must match package command builder.');
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

if (failures.length > 0) {
  console.error('super-resolution UI action command failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`super-resolution UI action command ok (${actionMetadata.toolName}, sources=${actionMetadata.sources})`);
