#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { parseComputationalMergeE2eProofManifest } from '../src/schemas/computationalMergeE2eProofSchemas.ts';
import { parsePrivateRawEvidenceLedger } from '../src/schemas/privateRawEvidenceSchemas.ts';
import { buildComputationalMergePrivateSourceSets } from '../src/utils/computationalMergeSourceSets.ts';
import { buildComputationalMergeReviewPanelDiagnostics } from '../src/utils/computationalMergeReviewPanels.ts';

const manifest = parseComputationalMergeE2eProofManifest(
  JSON.parse(await readFile('fixtures/validation/computational-merge-e2e-proof.json', 'utf8')),
);
const ledger = parsePrivateRawEvidenceLedger(
  JSON.parse(await readFile('fixtures/detail/private-raw-evidence-ledger.json', 'utf8')),
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
}

if (failures.length > 0) {
  console.error('Computational merge review-panel contract failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`computational merge review-panel contract ok (${diagnostics.diagnostics.length} synthetic diagnostics)`);
