#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const DASHBOARD_PATH = 'docs/validation/reports/goal-review-2026-06-11.html';
const dashboard = readFileSync(DASHBOARD_PATH, 'utf8');
const dashboardDir = dirname(DASHBOARD_PATH);
const failures: string[] = [];

const requireText = (text: string) => {
  if (!dashboard.includes(text)) failures.push(`missing ${text}`);
};

for (const text of [
  '<title>RawEngine Goal Review</title>',
  'Maintained: 2026-06-22',
  'Snapshot: 2026-06-22',
  'Issue: #3101',
  'Capability Status Buckets',
  'User-Visible Feature Proofs',
  'Computational Runtime Proofs',
  'Brush Mask Canvas Proof',
  'Layer Stack Proofs',
  'Color And RAW Proofs',
  'Issue #3094 remains open',
  'Issue #3100 still needs',
  'not a routine product validation gate',
  'not proof of product runtime behavior',
]) {
  requireText(text);
}

for (const artifact of [
  'agent-expert-edit-demo-workflow-2026-06-21.html',
  'agent-replay-proof-gallery-2026-06-16.html',
  'brush-mask-canvas-ui-proof-2026-06-22.json',
  'hdr-synthetic-output-artifact-proof-2026-06-20.json',
  'panorama-real-raw-private-proof-2026-06-20.json',
  'focus-synthetic-output-artifact-proof-2026-06-20.json',
  'sr-synthetic-output-artifact-proof-2026-06-20.json',
  'layer-stack-ui-proof-2026-06-20.json',
  'layer-visibility-opacity-proof-2026-06-21.json',
  'negative-lab-qc-contact-sheet-proof-2026-06-16.svg',
  'professional-color-workflow-cc-raw-proof-2026-06-20.json',
  'skin-tone-uniformity-local-raw-proof-2026-06-21.json',
]) {
  const path = normalize(join(dashboardDir, artifact));
  if (!existsSync(path)) failures.push(`missing linked artifact ${artifact}`);
  requireText(artifact);
}

if (failures.length > 0) {
  console.error(`goal review dashboard failed (${failures.length})`);
  console.error(failures.slice(0, 20).join('\n'));
  process.exit(1);
}

console.log('goal review dashboard ok');
