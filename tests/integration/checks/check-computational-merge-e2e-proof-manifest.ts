#!/usr/bin/env bun

import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseComputationalMergeE2eProofManifest } from '../../../src/schemas/computational-merge/computationalMergeE2eProofSchemas.ts';
import { parsePrivateRawEvidenceLedger } from '../../../src/schemas/privateRawEvidenceSchemas.ts';

const requireAssets = process.argv.includes('--require-assets');
const root = process.env.RAWENGINE_PRIVATE_RAW_ROOT;
const failures: string[] = [];

if (requireAssets && root === undefined) {
  failures.push('RAWENGINE_PRIVATE_RAW_ROOT is required with --require-assets.');
}

const manifest = parseComputationalMergeE2eProofManifest(
  JSON.parse(await readFile('fixtures/validation/app-server/computational-merge-e2e-proof.json', 'utf8')),
);
const ledger = parsePrivateRawEvidenceLedger(
  JSON.parse(await readFile('fixtures/detail/proofs/private-raw-evidence-ledger.json', 'utf8')),
);
const ledgerEntries = new Map(ledger.entries.map((entry) => [entry.evidenceId, entry]));

for (const proofCase of manifest.proofCases) {
  const ledgerEntry = ledgerEntries.get(proofCase.evidenceId);
  if (ledgerEntry === undefined) {
    failures.push(`${proofCase.fixtureId}: missing private RAW evidence ledger entry ${proofCase.evidenceId}.`);
    continue;
  }

  if (ledgerEntry.featureFamily !== proofCase.featureFamily) {
    failures.push(`${proofCase.fixtureId}: ledger feature family must be ${proofCase.featureFamily}.`);
  }
  if (!ledgerEntry.expectedUse.includes(proofCase.featureFamily)) {
    failures.push(`${proofCase.fixtureId}: ledger expectedUse must include ${proofCase.featureFamily}.`);
  }
  if (ledgerEntry.trackingIssue !== proofCase.implementationIssue) {
    failures.push(`${proofCase.fixtureId}: ledger tracking issue must match #${proofCase.implementationIssue}.`);
  }
  if (proofCase.proofStatus === 'e2e_verified_private_assets' && ledgerEntry.status !== 'private_asset_available') {
    failures.push(`${proofCase.fixtureId}: E2E-verified proof requires an available private RAW ledger asset.`);
  }

  if (root !== undefined && proofCase.proofStatus !== 'manifest_only') {
    for (const artifact of proofCase.artifacts) {
      try {
        await access(resolve(root, artifact.path));
      } catch {
        failures.push(`${proofCase.fixtureId}: missing private proof artifact ${artifact.path}.`);
      }
    }
    for (const sourcePath of proofCase.localSourceRelativePaths) {
      try {
        await access(resolve(root, sourcePath));
      } catch {
        failures.push(`${proofCase.fixtureId}: missing private RAW source ${sourcePath}.`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Computational merge E2E proof manifest failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

const hasAssetCheckedCase = manifest.proofCases.some((proofCase) => proofCase.proofStatus !== 'manifest_only');
const mode =
  root === undefined
    ? 'schema-only public mode'
    : hasAssetCheckedCase
      ? 'private asset mode'
      : 'private root supplied; manifest-only cases did not require artifacts';
console.log(`computational merge E2E proof manifest ok (${manifest.proofCases.length} cases, ${mode})`);
