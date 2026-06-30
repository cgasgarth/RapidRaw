#!/usr/bin/env bun

import {
  buildSuperResolutionUiApplyCommandV1,
  buildSuperResolutionUiDryRunCommandV1,
} from '../../../packages/rawengine-schema/src/super-resolution/superResolutionUiControls.ts';
import { runComputationalUiApiSmoke } from '../../../scripts/lib/computational/ui-api-smoke.ts';

runComputationalUiApiSmoke({
  buildApplyCommand: buildSuperResolutionUiApplyCommandV1,
  buildDryRunCommand: buildSuperResolutionUiDryRunCommandV1,
  label: 'sr',
  validDryRunArgs: [
    {
      alignmentMode: 'optical_flow',
      detailPolicy: 'balanced',
      maxPreviewDimensionPx: 4096,
      outputName: 'Burst Super Resolution',
      outputScale: 2,
      qualityPreference: 'best',
      reconstructionMode: 'optical_flow',
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
  ],
  assertDryRunCommand: (command, failures) => {
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
    if (command.parameters.reconstructionMode !== 'optical_flow') {
      failures.push('SR UI mapper must preserve reconstruction mode.');
    }
  },
  validApplyArgs: [
    {
      alignmentMode: 'homography',
      detailPolicy: 'balanced',
      outputName: 'Burst Super Resolution',
      outputScale: 3,
      qualityPreference: 'balanced',
      reconstructionMode: 'model_detail',
      sources: [
        { exposureEv: 0, imagePath: '/photos/sr/SR_0001.CR3', sourceIndex: 0 },
        { exposureEv: 0, imagePath: '/photos/sr/SR_0002.CR3', sourceIndex: 1 },
      ],
    },
    {
      acceptedDryRunPlanHash: 'sha256:sr-ui-plan-001',
      acceptedDryRunPlanId: 'sr_ui_plan_001',
      commandId: 'command_sr_ui_apply_001',
      correlationId: 'corr_sr_ui_apply_001',
      expectedGraphRevision: 'graph_rev_sr_ui_001',
      idempotencyKey: 'idem_sr_ui_apply_001',
      targetId: 'project_sr_ui_001',
    },
  ],
  assertApplyCommand: (command, failures) => {
    if (command.dryRun || command.approval.approvalClass !== 'edit_apply') {
      failures.push('SR UI apply mapper must produce approved edit-apply commands.');
    }
    if (command.parameters.acceptedDryRunPlanId !== 'sr_ui_plan_001') {
      failures.push('SR UI apply mapper must require and preserve accepted dry-run plan IDs.');
    }
    if (command.parameters.outputScale !== 3 || command.parameters.detailPolicy !== 'balanced') {
      failures.push('SR UI apply mapper must preserve UI control overrides.');
    }
    if (command.parameters.reconstructionMode !== 'model_detail') {
      failures.push('SR UI apply mapper must preserve reconstruction mode.');
    }
  },
  invalidCases: [
    {
      message: 'SR UI apply mapper accepted aggressive preview-only detail policy.',
      run: () =>
        buildSuperResolutionUiApplyCommandV1(
          {
            alignmentMode: 'homography',
            detailPolicy: 'aggressive_preview_only',
            outputName: 'Invalid Aggressive SR Apply',
            outputScale: 2,
            sources: [
              { imagePath: '/photos/sr/SR_0001.CR3', sourceIndex: 0 },
              { imagePath: '/photos/sr/SR_0002.CR3', sourceIndex: 1 },
            ],
          },
          {
            acceptedDryRunPlanHash: 'sha256:sr-ui-plan-001',
            acceptedDryRunPlanId: 'sr_ui_plan_001',
            commandId: 'command_sr_ui_apply_invalid_aggressive',
            correlationId: 'corr_sr_ui_apply_invalid_aggressive',
            expectedGraphRevision: 'graph_rev_sr_ui_001',
            targetId: 'project_sr_ui_001',
          },
        ),
    },
    {
      message: 'SR UI apply mapper accepted a missing acceptedDryRunPlanHash.',
      run: () =>
        buildSuperResolutionUiApplyCommandV1(
          {
            alignmentMode: 'auto',
            detailPolicy: 'conservative',
            outputName: 'Invalid SR Apply',
            outputScale: 2,
            sources: [
              { imagePath: '/photos/sr/SR_0001.CR3', sourceIndex: 0 },
              { imagePath: '/photos/sr/SR_0002.CR3', sourceIndex: 1 },
            ],
          },
          {
            acceptedDryRunPlanId: 'sr_ui_plan_001',
            commandId: 'command_sr_ui_apply_invalid',
            correlationId: 'corr_sr_ui_apply_invalid',
            expectedGraphRevision: 'graph_rev_sr_ui_001',
            targetId: 'project_sr_ui_001',
          },
        ),
    },
    {
      message: 'SR UI mapper accepted a single multi-image source.',
      run: () =>
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
        ),
    },
    {
      message: 'SR UI mapper accepted disabled alignment.',
      run: () =>
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
        ),
    },
  ],
});
