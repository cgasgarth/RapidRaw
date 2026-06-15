#!/usr/bin/env bun

import { buildHdrMergeUiDryRunCommandV1 } from '../packages/rawengine-schema/src/hdrMergeUiControls.ts';

const command = buildHdrMergeUiDryRunCommandV1(
  {
    outputName: 'Kitchen Window HDR',
    sources: [
      { exposureEv: -2, imagePath: '/photos/hdr/IMG_1001.CR3', sourceIndex: 0 },
      { exposureEv: 0, imagePath: '/photos/hdr/IMG_1002.CR3', sourceIndex: 1 },
      { exposureEv: 2, imagePath: '/photos/hdr/IMG_1003.CR3', sourceIndex: 2 },
    ],
  },
  {
    commandId: 'command_hdr_ui_dry_run_001',
    correlationId: 'corr_hdr_ui_dry_run_001',
    expectedGraphRevision: 'graph_rev_hdr_ui_001',
    targetId: 'project_hdr_ui_001',
  },
);

const failures = [];

if (command.commandType !== 'computationalMerge.createHdr') {
  failures.push('HDR UI mapper produced wrong command type.');
}
if (!command.dryRun || command.approval.approvalClass !== 'preview_only') {
  failures.push('HDR UI mapper must produce preview-only dry-run commands.');
}
if (command.parameters.sources.some((source) => source.role !== 'hdr_bracket')) {
  failures.push('HDR UI mapper must assign hdr_bracket source roles.');
}
if (command.parameters.sources.some((source) => source.exposureEv === undefined)) {
  failures.push('HDR UI mapper must preserve exposure EV values.');
}

let blockedMissingExposure = false;
try {
  buildHdrMergeUiDryRunCommandV1(
    {
      outputName: 'Invalid HDR',
      sources: [
        { exposureEv: 0, imagePath: '/photos/hdr/IMG_1001.CR3', sourceIndex: 0 },
        { imagePath: '/photos/hdr/IMG_1002.CR3', sourceIndex: 1 },
      ],
    },
    {
      commandId: 'command_hdr_ui_invalid',
      correlationId: 'corr_hdr_ui_invalid',
      expectedGraphRevision: 'graph_rev_hdr_ui_001',
      targetId: 'project_hdr_ui_001',
    },
  );
} catch {
  blockedMissingExposure = true;
}

if (!blockedMissingExposure) {
  failures.push('HDR UI mapper accepted required bracket validation without exposure EV.');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('hdr UI/API ok');
