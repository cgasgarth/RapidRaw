#!/usr/bin/env bun

import { buildFocusStackUiDryRunCommandV1 } from '../packages/rawengine-schema/src/focusStackUiControls.ts';

const command = buildFocusStackUiDryRunCommandV1(
  {
    alignmentMode: 'homography',
    blendMethod: 'depth_map',
    maxPreviewDimensionPx: 4096,
    outputName: 'Macro Focus Stack',
    qualityPreference: 'best',
    retouchLayerPolicy: 'generate_retouch_layer',
    sources: [
      { focusDistanceMm: 180, imagePath: '/photos/focus/FOCUS_0001.CR3', sourceIndex: 0 },
      { focusDistanceMm: 240, imagePath: '/photos/focus/FOCUS_0002.CR3', sourceIndex: 1 },
      { focusDistanceMm: 320, imagePath: '/photos/focus/FOCUS_0003.CR3', sourceIndex: 2 },
    ],
  },
  {
    commandId: 'command_focus_ui_dry_run_001',
    correlationId: 'corr_focus_ui_dry_run_001',
    expectedGraphRevision: 'graph_rev_focus_ui_001',
    targetId: 'project_focus_ui_001',
  },
);

const failures = [];

if (command.commandType !== 'computationalMerge.createFocusStack') {
  failures.push('Focus UI mapper produced wrong command type.');
}
if (!command.dryRun || command.approval.approvalClass !== 'preview_only') {
  failures.push('Focus UI mapper must produce preview-only dry-run commands.');
}
if (command.parameters.sources.some((source) => source.role !== 'focus_slice')) {
  failures.push('Focus UI mapper must assign focus_slice source roles.');
}
if (command.parameters.blendMethod !== 'depth_map') {
  failures.push('Focus UI mapper must preserve blend method.');
}
if (command.parameters.retouchLayerPolicy !== 'generate_retouch_layer') {
  failures.push('Focus UI mapper must preserve retouch layer policy.');
}

let blockedSingleSource = false;
try {
  buildFocusStackUiDryRunCommandV1(
    {
      alignmentMode: 'translation',
      blendMethod: 'laplacian_pyramid',
      outputName: 'Invalid Focus Stack',
      retouchLayerPolicy: 'none',
      sources: [{ imagePath: '/photos/focus/FOCUS_0001.CR3', sourceIndex: 0 }],
    },
    {
      commandId: 'command_focus_ui_invalid',
      correlationId: 'corr_focus_ui_invalid',
      expectedGraphRevision: 'graph_rev_focus_ui_001',
      targetId: 'project_focus_ui_001',
    },
  );
} catch {
  blockedSingleSource = true;
}

if (!blockedSingleSource) {
  failures.push('Focus UI mapper accepted a single source.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('focus UI/API ok');
