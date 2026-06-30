#!/usr/bin/env bun

import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parsePrivateRawEvidenceLedger } from '../../../src/schemas/privateRawEvidenceSchemas.ts';
import { parseRawOpenEditExportProofManifest } from '../../../src/schemas/rawOpenEditExportProofSchemas.ts';

const requireAssets = process.argv.includes('--require-assets');
const root = process.env.RAWENGINE_PRIVATE_RAW_ROOT;
const failures = [];

if (requireAssets && root === undefined) {
  failures.push('RAWENGINE_PRIVATE_RAW_ROOT is required with --require-assets.');
}

const manifest = parseRawOpenEditExportProofManifest(
  JSON.parse(await readFile('fixtures/validation/raw-open-edit-export-proof.json', 'utf8')),
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

  if (!ledgerEntry.expectedUse.includes('preview_export_parity')) {
    failures.push(`${proofCase.fixtureId}: ledger entry must include preview_export_parity expectedUse.`);
  }
  if (ledgerEntry.trackingIssue !== proofCase.trackingIssue && ledgerEntry.trackingIssue !== 1149) {
    failures.push(`${proofCase.fixtureId}: ledger tracking issue must be #1376 or umbrella #1149.`);
  }
  if (proofCase.status === 'accepted_private_asset' && ledgerEntry.status !== 'private_asset_available') {
    failures.push(`${proofCase.fixtureId}: accepted proof cases require an available private RAW ledger asset.`);
  }

  if (root !== undefined) {
    for (const artifact of proofCase.artifacts) {
      try {
        await access(resolve(root, artifact.path));
      } catch {
        failures.push(`${proofCase.fixtureId}: missing private proof artifact ${artifact.path}.`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('RAW open/edit/export proof validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

const mode = root === undefined ? 'schema-only public mode' : 'private asset mode';
console.log(`raw open/edit/export proof ok (${manifest.proofCases.length} cases, ${mode})`);
