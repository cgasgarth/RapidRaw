#!/usr/bin/env bun

import {
  buildPanoramaUiApplyCommandV1,
  buildPanoramaUiDryRunCommandV1,
} from '../packages/rawengine-schema/src/panoramaUiControls.ts';

const command = buildPanoramaUiDryRunCommandV1(
  {
    blendMode: 'multi_band',
    boundaryMode: 'auto_crop',
    exposureMode: 'gain_compensation',
    maxPreviewDimensionPx: 4096,
    outputName: 'Ridge Overlook Panorama',
    projection: 'cylindrical',
    qualityPreference: 'best',
    sources: [
      { exposureEv: 0, imagePath: '/photos/pano/PANO_0001.CR3', sourceIndex: 0 },
      { exposureEv: 0, imagePath: '/photos/pano/PANO_0002.CR3', sourceIndex: 1 },
      { exposureEv: 0, imagePath: '/photos/pano/PANO_0003.CR3', sourceIndex: 2 },
    ],
  },
  {
    commandId: 'command_panorama_ui_dry_run_001',
    correlationId: 'corr_panorama_ui_dry_run_001',
    expectedGraphRevision: 'graph_rev_panorama_ui_001',
    targetId: 'project_panorama_ui_001',
  },
);

const failures = [];

if (command.commandType !== 'computationalMerge.createPanorama') {
  failures.push('Panorama UI mapper produced wrong command type.');
}
if (!command.dryRun || command.approval.approvalClass !== 'preview_only') {
  failures.push('Panorama UI mapper must produce preview-only dry-run commands.');
}
if (command.parameters.sources.some((source) => source.role !== 'panorama_tile')) {
  failures.push('Panorama UI mapper must assign panorama_tile source roles.');
}
if (command.parameters.blendMode !== 'multi_band') {
  failures.push('Panorama UI mapper must preserve blend mode.');
}
if (command.parameters.exposureNormalization !== 'auto') {
  failures.push('Panorama UI mapper must map gain compensation to API exposure normalization.');
}

const applyCommand = buildPanoramaUiApplyCommandV1(
  {
    blendMode: 'feather',
    boundaryMode: 'transparent',
    exposureMode: 'none',
    outputName: 'Ridge Overlook Panorama',
    projection: 'spherical',
    sources: [
      { exposureEv: 0, imagePath: '/photos/pano/PANO_0001.CR3', sourceIndex: 0 },
      { exposureEv: 0, imagePath: '/photos/pano/PANO_0002.CR3', sourceIndex: 1 },
    ],
  },
  {
    acceptedDryRunPlanHash: 'sha256:panorama-ui-plan-001',
    acceptedDryRunPlanId: 'panorama_ui_plan_001',
    commandId: 'command_panorama_ui_apply_001',
    correlationId: 'corr_panorama_ui_apply_001',
    expectedGraphRevision: 'graph_rev_panorama_ui_001',
    idempotencyKey: 'idem_panorama_ui_apply_001',
    targetId: 'project_panorama_ui_001',
  },
);

if (applyCommand.dryRun || applyCommand.approval.approvalClass !== 'edit_apply') {
  failures.push('Panorama UI apply mapper must produce approved edit-apply commands.');
}
if (applyCommand.parameters.acceptedDryRunPlanId !== 'panorama_ui_plan_001') {
  failures.push('Panorama UI apply mapper must require and preserve accepted dry-run plan IDs.');
}
if (applyCommand.parameters.exposureNormalization !== 'none' || applyCommand.parameters.blendMode !== 'feather') {
  failures.push('Panorama UI apply mapper must preserve UI control overrides.');
}

let blockedMissingPlan = false;
try {
  buildPanoramaUiApplyCommandV1(
    {
      boundaryMode: 'auto_crop',
      outputName: 'Invalid Panorama Apply',
      projection: 'cylindrical',
      sources: [
        { imagePath: '/photos/pano/PANO_0001.CR3', sourceIndex: 0 },
        { imagePath: '/photos/pano/PANO_0002.CR3', sourceIndex: 1 },
      ],
    },
    {
      acceptedDryRunPlanId: 'panorama_ui_plan_001',
      commandId: 'command_panorama_ui_apply_invalid',
      correlationId: 'corr_panorama_ui_apply_invalid',
      expectedGraphRevision: 'graph_rev_panorama_ui_001',
      targetId: 'project_panorama_ui_001',
    },
  );
} catch {
  blockedMissingPlan = true;
}

if (!blockedMissingPlan) {
  failures.push('Panorama UI apply mapper accepted a missing acceptedDryRunPlanHash.');
}

let blockedSingleSource = false;
try {
  buildPanoramaUiDryRunCommandV1(
    {
      boundaryMode: 'auto_crop',
      outputName: 'Invalid Panorama',
      projection: 'cylindrical',
      sources: [{ imagePath: '/photos/pano/PANO_0001.CR3', sourceIndex: 0 }],
    },
    {
      commandId: 'command_panorama_ui_invalid',
      correlationId: 'corr_panorama_ui_invalid',
      expectedGraphRevision: 'graph_rev_panorama_ui_001',
      targetId: 'project_panorama_ui_001',
    },
  );
} catch {
  blockedSingleSource = true;
}

if (!blockedSingleSource) {
  failures.push('Panorama UI mapper accepted a single source.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('panorama UI/API ok');
