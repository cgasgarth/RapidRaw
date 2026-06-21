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
const productivityActionsSource = await readFile('src/hooks/useProductivityActions.ts', 'utf8');
const failures: string[] = [];

if (!productivityActionsSource.includes("getComputationalMergeAppServerRoutePairSummary('panorama').dryRunToolName")) {
  failures.push('Panorama start action must store the typed app-server dry-run route.');
}
if (!productivityActionsSource.includes('lastDryRunCommand: dryRunCommand')) {
  failures.push('Panorama start action must persist dry-run command metadata.');
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
if (actionMetadata.commandType !== packageCommand.commandType) {
  failures.push('Panorama UI action command type must match package command builder.');
}
if (actionMetadata.dryRun !== true || packageCommand.dryRun !== true) {
  failures.push('Panorama UI action command must be dry-run only.');
}
if (actionMetadata.sourceCount !== packageCommand.parameters.sources.length) {
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
