#!/usr/bin/env bun

import {
  buildHdrMergeUiApplyCommandV1,
  buildHdrMergeUiDryRunCommandV1,
} from '../../../packages/rawengine-schema/src/hdrMergeUiControls.ts';
import { runComputationalUiApiSmoke } from '../../../scripts/lib/computational-ui-api-smoke.ts';

const hdrSources = [
  { exposureEv: -2, imagePath: '/photos/hdr/IMG_1001.CR3', sourceIndex: 0 },
  { exposureEv: 0, imagePath: '/photos/hdr/IMG_1002.CR3', sourceIndex: 1 },
  { exposureEv: 2, imagePath: '/photos/hdr/IMG_1003.CR3', sourceIndex: 2 },
];

runComputationalUiApiSmoke({
  buildApplyCommand: buildHdrMergeUiApplyCommandV1,
  buildDryRunCommand: buildHdrMergeUiDryRunCommandV1,
  label: 'hdr',
  validDryRunArgs: [
    { outputName: 'Kitchen Window HDR', sources: hdrSources },
    {
      commandId: 'command_hdr_ui_dry_run_001',
      correlationId: 'corr_hdr_ui_dry_run_001',
      expectedGraphRevision: 'graph_rev_hdr_ui_001',
      targetId: 'project_hdr_ui_001',
    },
  ],
  assertDryRunCommand: (command, failures) => {
    if (command.commandType !== 'computationalMerge.createHdr')
      failures.push('HDR UI mapper produced wrong command type.');
    if (!command.dryRun || command.approval.approvalClass !== 'preview_only') {
      failures.push('HDR UI mapper must produce preview-only dry-run commands.');
    }
    if (command.parameters.sources.some((source) => source.role !== 'hdr_bracket')) {
      failures.push('HDR UI mapper must assign hdr_bracket source roles.');
    }
    if (command.parameters.sources.some((source) => source.exposureEv === undefined)) {
      failures.push('HDR UI mapper must preserve exposure EV values.');
    }
  },
  validApplyArgs: [
    { deghosting: 'high', outputName: 'Kitchen Window HDR', sources: hdrSources },
    {
      acceptedDryRunPlanHash: 'sha256:hdr-ui-plan-001',
      acceptedDryRunPlanId: 'hdr_ui_plan_001',
      commandId: 'command_hdr_ui_apply_001',
      correlationId: 'corr_hdr_ui_apply_001',
      expectedGraphRevision: 'graph_rev_hdr_ui_001',
      idempotencyKey: 'idem_hdr_ui_apply_001',
      targetId: 'project_hdr_ui_001',
    },
  ],
  assertApplyCommand: (command, failures) => {
    if (command.dryRun || command.approval.approvalClass !== 'edit_apply') {
      failures.push('HDR UI apply mapper must produce approved edit-apply commands.');
    }
    if (command.parameters.acceptedDryRunPlanId !== 'hdr_ui_plan_001') {
      failures.push('HDR UI apply mapper must require and preserve accepted dry-run plan IDs.');
    }
    if (command.parameters.deghosting !== 'high') {
      failures.push('HDR UI apply mapper must preserve UI control overrides.');
    }
  },
  invalidCases: [
    {
      message: 'HDR UI apply mapper accepted a missing acceptedDryRunPlanHash.',
      run: () =>
        buildHdrMergeUiApplyCommandV1(
          {
            outputName: 'Invalid HDR Apply',
            sources: [
              { exposureEv: -1, imagePath: '/photos/hdr/IMG_1001.CR3', sourceIndex: 0 },
              { exposureEv: 1, imagePath: '/photos/hdr/IMG_1002.CR3', sourceIndex: 1 },
            ],
          },
          {
            acceptedDryRunPlanId: 'hdr_ui_plan_001',
            commandId: 'command_hdr_ui_apply_invalid',
            correlationId: 'corr_hdr_ui_apply_invalid',
            expectedGraphRevision: 'graph_rev_hdr_ui_001',
            targetId: 'project_hdr_ui_001',
          },
        ),
    },
    {
      message: 'HDR UI mapper accepted required bracket validation without exposure EV.',
      run: () =>
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
        ),
    },
  ],
});
