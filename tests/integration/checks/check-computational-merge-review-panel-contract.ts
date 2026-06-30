#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { parseComputationalMergeE2eProofManifest } from '../../../src/schemas/computational-merge/computationalMergeE2eProofSchemas.ts';
import { parsePrivateRawEvidenceLedger } from '../../../src/schemas/privateRawEvidenceSchemas.ts';
import { buildComputationalMergeReviewPanelDiagnostics } from '../../../src/utils/computational-merge/computationalMergeReviewPanels.ts';
import { computationalMergeReviewThresholds } from '../../../src/utils/computational-merge/computationalMergeReviewThresholds.ts';
import { buildComputationalMergePrivateSourceSets } from '../../../src/utils/computational-merge/computationalMergeSourceSets.ts';

const manifest = parseComputationalMergeE2eProofManifest(
  JSON.parse(await readFile('fixtures/validation/app-server/computational-merge-e2e-proof.json', 'utf8')),
);
const ledger = parsePrivateRawEvidenceLedger(
  JSON.parse(await readFile('fixtures/detail/proofs/private-raw-evidence-ledger.json', 'utf8')),
);
const sourceSets = buildComputationalMergePrivateSourceSets(manifest, ledger);
const diagnostics = buildComputationalMergeReviewPanelDiagnostics(sourceSets.sourceSets);
const failures: string[] = [];

for (const diagnostic of diagnostics.diagnostics) {
  const proofCase = manifest.proofCases.find((candidate) => candidate.fixtureId === diagnostic.fixtureId);
  if (proofCase === undefined) {
    failures.push(`${diagnostic.fixtureId}: missing proof case.`);
    continue;
  }

  if (diagnostic.proofStatus !== proofCase.proofStatus) {
    failures.push(`${diagnostic.fixtureId}: proof status must mirror manifest.`);
  }
  if (diagnostic.proofLevel !== 'synthetic_runtime') {
    failures.push(`${diagnostic.fixtureId}: public diagnostics must stay synthetic runtime only.`);
  }
  if (!diagnostic.nonClaims.includes('not_raw_decode_verified')) {
    failures.push(`${diagnostic.fixtureId}: must preserve RAW decode non-claim.`);
  }
  if (!diagnostic.nonClaims.includes('not_ui_e2e_verified')) {
    failures.push(`${diagnostic.fixtureId}: must preserve UI E2E non-claim.`);
  }
  if (diagnostic.sourceSet.sourceCount !== proofCase.localSourceRelativePaths.length) {
    failures.push(`${diagnostic.fixtureId}: source count must match proof manifest.`);
  }
  if (diagnostic.qualityMetrics.some((metric) => metric.source !== 'synthetic_runtime')) {
    failures.push(`${diagnostic.fixtureId}: public checker must not claim private RAW metrics.`);
  }
  for (const metric of diagnostic.qualityMetrics) {
    const expectedThreshold = expectedSyntheticThreshold(diagnostic.featureFamily, metric.name);
    if (expectedThreshold === undefined) {
      failures.push(`${diagnostic.fixtureId}: unexpected synthetic metric ${metric.name}.`);
      continue;
    }
    if (metric.threshold !== expectedThreshold) {
      failures.push(
        `${diagnostic.fixtureId}: ${metric.name} threshold ${metric.threshold} must equal ${expectedThreshold}.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('Computational merge review-panel contract failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`computational merge review-panel contract ok (${diagnostics.diagnostics.length} synthetic diagnostics)`);

function expectedSyntheticThreshold(featureFamily: string, metricName: string): number | undefined {
  switch (featureFamily) {
    case 'focus_stack':
      switch (metricName) {
        case 'focusTransitionArtifactScore':
          return computationalMergeReviewThresholds.focus_stack.focusTransitionArtifactScore;
        case 'sharpnessGainRatio':
          return computationalMergeReviewThresholds.focus_stack.sharpnessGainRatio;
      }
      return undefined;
    case 'panorama_stitch':
      switch (metricName) {
        case 'alignmentInlierRatio':
          return computationalMergeReviewThresholds.panorama_stitch.alignmentInlierRatio;
        case 'edgeContinuityScore':
          return computationalMergeReviewThresholds.panorama_stitch.edgeContinuityScore;
      }
      return undefined;
    case 'super_resolution':
      switch (metricName) {
        case 'alignmentInlierRatio':
          return computationalMergeReviewThresholds.super_resolution.alignmentInlierRatio;
        case 'superResolutionDetailGainRatio':
          return computationalMergeReviewThresholds.super_resolution.superResolutionDetailGainRatio;
      }
      return undefined;
  }
  return undefined;
}
