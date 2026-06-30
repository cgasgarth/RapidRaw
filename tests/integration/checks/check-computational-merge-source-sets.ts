#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { parseComputationalMergeE2eProofManifest } from '../../../src/schemas/computationalMergeE2eProofSchemas.ts';
import { parsePrivateRawEvidenceLedger } from '../../../src/schemas/privateRawEvidenceSchemas.ts';
import { buildComputationalMergePrivateSourceSets } from '../../../src/utils/computationalMergeSourceSets.ts';

const manifest = parseComputationalMergeE2eProofManifest(
  JSON.parse(await readFile('fixtures/validation/app-server/computational-merge-e2e-proof.json', 'utf8')),
);
const ledger = parsePrivateRawEvidenceLedger(
  JSON.parse(await readFile('fixtures/detail/proofs/private-raw-evidence-ledger.json', 'utf8')),
);
const collection = buildComputationalMergePrivateSourceSets(manifest, ledger);

const failures: string[] = [];
const ledgerEntriesByEvidenceId = new Map(ledger.entries.map((entry) => [entry.evidenceId, entry]));

for (const sourceSet of collection.sourceSets) {
  const ledgerEntry = ledgerEntriesByEvidenceId.get(sourceSet.evidenceId);
  if (ledgerEntry === undefined) {
    failures.push(`${sourceSet.fixtureId}: missing ledger entry.`);
    continue;
  }

  for (const sourceItem of sourceSet.sourceItems) {
    if (!sourceItem.localRelativePath.endsWith(`.${ledgerEntry.camera.rawFormat}`)) {
      failures.push(`${sourceSet.fixtureId}: source ${sourceItem.sourceIndex} extension must match ledger RAW format.`);
    }
  }
  if (sourceSet.proofStatus === 'manifest_only') {
    const proofCase = manifest.proofCases.find((candidate) => candidate.fixtureId === sourceSet.fixtureId);
    if (proofCase === undefined || !proofCase.nonClaims.includes('not_runtime_e2e_verified')) {
      failures.push(`${sourceSet.fixtureId}: manifest-only source set must preserve runtime E2E non-claim.`);
    }
  }
}

if (failures.length > 0) {
  console.error('Computational merge source-set validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`computational merge source sets ok (${collection.sourceSets.length} sets)`);
