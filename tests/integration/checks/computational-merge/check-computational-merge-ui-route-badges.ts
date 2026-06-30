#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_PAIRS } from '../../../../src/utils/computational-merge/computationalMergeAppServerRoutePairs.ts';
import { COMPUTATIONAL_MERGE_APP_SERVER_ROUTES } from '../../../../src/utils/computational-merge/computationalMergeAppServerRoutes.ts';

const modalCoverage = [
  { family: 'hdr', file: 'src/components/modals/computational-merge/HdrModal.tsx' },
  { family: 'panorama', file: 'src/components/modals/computational-merge/PanoramaModal.tsx' },
  { family: 'focus_stack', file: 'src/components/modals/computational-merge/FocusStackModal.tsx' },
  { family: 'super_resolution', file: 'src/components/modals/computational-merge/SuperResolutionModal.tsx' },
];

const failures = [];
const routeFamilies = new Set(COMPUTATIONAL_MERGE_APP_SERVER_ROUTES.map((route) => route.family));
const routeToolNames = new Set(COMPUTATIONAL_MERGE_APP_SERVER_ROUTES.map((route) => route.toolName));

for (const { family, file } of modalCoverage) {
  const source = readFileSync(file, 'utf8');
  if (!routeFamilies.has(family)) failures.push(`${family} has no app-server route manifest entry.`);
  const directBadgeRegex = new RegExp(`<ComputationalMergeAppServerBadge[\\s\\S]*?family="${family}"`, 'u');
  const setupShellBadgeRegex = new RegExp(`<ComputationalSetupModalShell[\\s\\S]*?appServerFamily="${family}"`, 'u');
  if (!directBadgeRegex.test(source) && !setupShellBadgeRegex.test(source)) {
    failures.push(`${file} does not render the ${family} app-server route badge.`);
  }
  if (source.includes('apiPending')) failures.push(`${file} still renders a pending API badge.`);
}

const badgeSource = readFileSync(
  'src/components/modals/computational-merge/ComputationalMergeAppServerBadge.tsx',
  'utf8',
);
for (const marker of ['getComputationalMergeAppServerRoutePairSummary', 'statusLabel', 'dryRunToolName']) {
  if (!badgeSource.includes(marker)) failures.push(`Route badge is missing ${marker}.`);
}

for (const [family, routePair] of Object.entries(COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_PAIRS)) {
  if (!routeToolNames.has(routePair.dryRunToolName)) failures.push(`${family} dry-run UI route is not in manifest.`);
  if (!routeToolNames.has(routePair.applyToolName)) failures.push(`${family} apply UI route is not in manifest.`);
}

if (failures.length > 0) {
  console.error('Computational merge UI route badge validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`computational merge UI route badges ok (${modalCoverage.length})`);
