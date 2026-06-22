#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { buildHdrMergeUiDryRunCommandV1 } from '../../../packages/rawengine-schema/src/hdrMergeUiControls.ts';
import { DEFAULT_HDR_MERGE_UI_SETTINGS } from '../../../src/schemas/hdrMergeUiSchemas.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../src/utils/computationalMergeAppServerRoutePairs.ts';

const actionMetadataSchema = z
  .object({
    toolName: z.literal(getComputationalMergeAppServerRoutePairSummary('hdr').dryRunToolName),
    commandType: z.literal('computationalMerge.createHdr'),
    dryRun: z.literal(true),
    sources: z.number().int().min(2),
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
const productivityActionsSource = await readFile('src/hooks/useProductivityActions.ts', 'utf8');
const failures: string[] = [];

if (!productivityActionsSource.includes("getComputationalMergeAppServerRoutePairSummary('hdr').dryRunToolName")) {
  failures.push('HDR start action must store the typed app-server dry-run route.');
}
if (!productivityActionsSource.includes('lastDryRunCommand: dryRunCommand')) {
  failures.push('HDR start action must persist dry-run command metadata.');
}
if (actionMetadata.toolName !== routePair.dryRunToolName) {
  failures.push('HDR UI action command must use the typed app-server dry-run route.');
}
if (actionMetadata.commandType !== packageCommand.commandType) {
  failures.push('HDR UI action command type must match package command builder.');
}
if (actionMetadata.dryRun !== true || packageCommand.dryRun !== true) {
  failures.push('HDR UI action command must be dry-run only.');
}
if (actionMetadata.sources !== packageCommand.parameters.sources.length) {
  failures.push('HDR UI action source count must match package command builder.');
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
