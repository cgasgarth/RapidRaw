#!/usr/bin/env bun

import { buildSuperResolutionUiDryRunCommandV1 } from '../packages/rawengine-schema/src/superResolutionUiControls.ts';

const command = buildSuperResolutionUiDryRunCommandV1(
  {
    alignmentMode: 'optical_flow',
    detailPolicy: 'balanced',
    maxPreviewDimensionPx: 4096,
    outputName: 'Burst Super Resolution',
    outputScale: 2,
    qualityPreference: 'best',
    sources: [
      { exposureEv: 0, imagePath: '/photos/sr/SR_0001.CR3', sourceIndex: 0 },
      { exposureEv: 0, imagePath: '/photos/sr/SR_0002.CR3', sourceIndex: 1 },
      { exposureEv: 0, imagePath: '/photos/sr/SR_0003.CR3', sourceIndex: 2 },
    ],
  },
  {
    commandId: 'command_sr_ui_dry_run_001',
    correlationId: 'corr_sr_ui_dry_run_001',
    expectedGraphRevision: 'graph_rev_sr_ui_001',
    targetId: 'project_sr_ui_001',
  },
);

const failures = [];

if (command.commandType !== 'computationalMerge.createSuperResolution') {
  failures.push('SR UI mapper produced wrong command type.');
}
if (!command.dryRun || command.approval.approvalClass !== 'preview_only') {
  failures.push('SR UI mapper must produce preview-only dry-run commands.');
}
if (command.parameters.mode !== 'multi_image') {
  failures.push('SR UI mapper must create multi-image super-resolution commands.');
}
if (command.parameters.sources.some((source) => source.role !== 'sr_frame')) {
  failures.push('SR UI mapper must assign sr_frame source roles.');
}
if (command.parameters.outputScale !== 2 || command.parameters.detailPolicy !== 'balanced') {
  failures.push('SR UI mapper must preserve output scale and detail policy.');
}

let blockedSingleSource = false;
try {
  buildSuperResolutionUiDryRunCommandV1(
    {
      alignmentMode: 'auto',
      detailPolicy: 'conservative',
      outputName: 'Invalid SR',
      outputScale: 2,
      sources: [{ imagePath: '/photos/sr/SR_0001.CR3', sourceIndex: 0 }],
    },
    {
      commandId: 'command_sr_ui_invalid_single',
      correlationId: 'corr_sr_ui_invalid_single',
      expectedGraphRevision: 'graph_rev_sr_ui_001',
      targetId: 'project_sr_ui_001',
    },
  );
} catch {
  blockedSingleSource = true;
}

let blockedMissingAlignment = false;
try {
  buildSuperResolutionUiDryRunCommandV1(
    {
      alignmentMode: 'none',
      detailPolicy: 'conservative',
      outputName: 'Invalid SR',
      outputScale: 2,
      sources: [
        { imagePath: '/photos/sr/SR_0001.CR3', sourceIndex: 0 },
        { imagePath: '/photos/sr/SR_0002.CR3', sourceIndex: 1 },
      ],
    },
    {
      commandId: 'command_sr_ui_invalid_alignment',
      correlationId: 'corr_sr_ui_invalid_alignment',
      expectedGraphRevision: 'graph_rev_sr_ui_001',
      targetId: 'project_sr_ui_001',
    },
  );
} catch {
  blockedMissingAlignment = true;
}

if (!blockedSingleSource) {
  failures.push('SR UI mapper accepted a single multi-image source.');
}
if (!blockedMissingAlignment) {
  failures.push('SR UI mapper accepted disabled alignment.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('sr UI/API ok');
