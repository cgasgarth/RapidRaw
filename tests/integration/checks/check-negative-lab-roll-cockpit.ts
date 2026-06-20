#!/usr/bin/env bun
// @ts-check

import { readFileSync } from 'node:fs';

const files = {
  modal: readFileSync('src/components/modals/NegativeConversionModal.tsx', 'utf8'),
  smoke: readFileSync('scripts/capture-visual-smoke.ts', 'utf8'),
  util: readFileSync('src/utils/negativeLabFrameHealth.ts', 'utf8'),
};

const failures = [];
const requireMarker = (source, marker, label) => {
  if (!source.includes(marker)) {
    failures.push(`${label}: missing ${marker}`);
  }
};

for (const marker of [
  'buildNegativeLabFrameHealthReport',
  'buildNegativeLabBatchDryRunSummary',
  'negative-lab-frame-health-grid',
  'negative-lab-frame-health-row-',
  'negative-lab-roll-frame-navigator',
  'negative-lab-roll-frame-navigator-proof',
  'negative-lab-roll-frame-strip',
  'negative-lab-roll-frame-status-',
  'negative-lab-roll-frame-runtime-',
  'negative-lab-workflow-readiness-strip',
  'negative-lab-workflow-queued',
  'negative-lab-workflow-preview',
  'negative-lab-workflow-export',
  'negative-lab-selected-stock-readiness',
  'negative-lab-frame-warning-chip-',
  'negative-lab-planned-apply-count',
  'negative-lab-skipped-frame-count',
  'negative-lab-copy-batch-plan',
  'negative-lab-accept-batch-plan',
  'acceptedBatchPlanIdentity',
]) {
  requireMarker(files.modal, marker, 'modal');
}

for (const marker of [
  'frameHealthReport.frames',
  'warningCodes',
  'excluded_from_batch',
  'base_estimate_active_frame_only',
  'preview_not_ready',
]) {
  requireMarker(files.util, marker, 'frame health');
}

for (const marker of [
  'negative-lab-frame-count',
  'negative-lab-roll-frame-navigator',
  'negative-lab-roll-frame-1',
  'negative-lab-roll-frame-status-1',
  'negative-lab-roll-frame-runtime-1',
  'negative-lab-roll-warning-count',
  'negative-lab-planned-apply-count',
  'negative-lab-skipped-frame-count',
  'negative-lab-copy-batch-plan',
  'negative-lab-accept-batch-plan',
  '"plannedApplyCount"',
  '"skippedFrameIds"',
]) {
  requireMarker(files.smoke, marker, 'visual smoke');
}

if (failures.length > 0) {
  console.error(`negative lab roll cockpit failed (${failures.length})`);
  console.error(failures.slice(0, 20).join('\n'));
  process.exit(1);
}

console.log('negative lab roll cockpit ok');
