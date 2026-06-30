#!/usr/bin/env bun

import {
  buildFocusStackUiApplyCommandV1,
  buildFocusStackUiDryRunCommandV1,
} from '../../../../packages/rawengine-schema/src/focus-stack/focusStackUiControls.ts';
import { runComputationalUiApiSmoke } from '../../../../scripts/lib/computational/ui-api-smoke.ts';

runComputationalUiApiSmoke({
  buildApplyCommand: buildFocusStackUiApplyCommandV1,
  buildDryRunCommand: buildFocusStackUiDryRunCommandV1,
  label: 'focus',
  validDryRunArgs: [
    {
      alignmentMode: 'homography',
      blendMethod: 'depth_map',
      haloSuppressionStrengthPercent: 80,
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
  ],
  assertDryRunCommand: (command, failures) => {
    if (command.commandType !== 'computationalMerge.createFocusStack') {
      failures.push('Focus UI mapper produced wrong command type.');
    }
    if (!command.dryRun || command.approval.approvalClass !== 'preview_only') {
      failures.push('Focus UI mapper must produce preview-only dry-run commands.');
    }
    if (command.parameters.sources.some((source) => source.role !== 'focus_slice')) {
      failures.push('Focus UI mapper must assign focus_slice source roles.');
    }
    if (command.parameters.blendMethod !== 'depth_map') failures.push('Focus UI mapper must preserve blend method.');
    if (command.parameters.haloSuppressionStrengthPercent !== 80) {
      failures.push('Focus UI mapper must preserve halo suppression.');
    }
    if (command.parameters.retouchLayerPolicy !== 'generate_retouch_layer') {
      failures.push('Focus UI mapper must preserve retouch layer policy.');
    }
  },
  validApplyArgs: [
    {
      alignmentMode: 'translation',
      blendMethod: 'weighted_sharpness',
      haloSuppressionStrengthPercent: 40,
      outputName: 'Macro Focus Stack',
      qualityPreference: 'balanced',
      retouchLayerPolicy: 'none',
      sources: [
        { focusDistanceMm: 180, imagePath: '/photos/focus/FOCUS_0001.CR3', sourceIndex: 0 },
        { focusDistanceMm: 240, imagePath: '/photos/focus/FOCUS_0002.CR3', sourceIndex: 1 },
      ],
    },
    {
      acceptedDryRunPlanHash: 'sha256:focus-ui-plan-001',
      acceptedDryRunPlanId: 'focus_ui_plan_001',
      commandId: 'command_focus_ui_apply_001',
      correlationId: 'corr_focus_ui_apply_001',
      expectedGraphRevision: 'graph_rev_focus_ui_001',
      idempotencyKey: 'idem_focus_ui_apply_001',
      targetId: 'project_focus_ui_001',
    },
  ],
  assertApplyCommand: (command, failures) => {
    if (command.dryRun || command.approval.approvalClass !== 'edit_apply') {
      failures.push('Focus UI apply mapper must produce approved edit-apply commands.');
    }
    if (command.parameters.acceptedDryRunPlanId !== 'focus_ui_plan_001') {
      failures.push('Focus UI apply mapper must require and preserve accepted dry-run plan IDs.');
    }
    if (command.parameters.blendMethod !== 'weighted_sharpness') {
      failures.push('Focus UI apply mapper must preserve UI control overrides.');
    }
    if (command.parameters.haloSuppressionStrengthPercent !== 40) {
      failures.push('Focus UI apply mapper must preserve halo suppression overrides.');
    }
  },
  invalidCases: [
    {
      message: 'Focus UI apply mapper accepted a missing acceptedDryRunPlanHash.',
      run: () =>
        buildFocusStackUiApplyCommandV1(
          {
            alignmentMode: 'translation',
            blendMethod: 'laplacian_pyramid',
            outputName: 'Invalid Focus Apply',
            retouchLayerPolicy: 'none',
            sources: [
              { imagePath: '/photos/focus/FOCUS_0001.CR3', sourceIndex: 0 },
              { imagePath: '/photos/focus/FOCUS_0002.CR3', sourceIndex: 1 },
            ],
          },
          {
            acceptedDryRunPlanId: 'focus_ui_plan_001',
            commandId: 'command_focus_ui_apply_invalid',
            correlationId: 'corr_focus_ui_apply_invalid',
            expectedGraphRevision: 'graph_rev_focus_ui_001',
            targetId: 'project_focus_ui_001',
          },
        ),
    },
    {
      message: 'Focus UI mapper accepted a single source.',
      run: () =>
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
        ),
    },
  ],
});
