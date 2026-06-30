#!/usr/bin/env bun

import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseDeblurRealRawQualityManifest } from '../../../../src/schemas/deblurRealRawQualitySchemas.ts';
import { parsePrivateRawEvidenceLedger } from '../../../../src/schemas/privateRawEvidenceSchemas.ts';

const manifest = parseDeblurRealRawQualityManifest(
  JSON.parse(await readFile('fixtures/detail/deblur/deblur-real-raw-quality.json', 'utf8')),
);
const ledger = parsePrivateRawEvidenceLedger(
  JSON.parse(await readFile('fixtures/detail/proofs/private-raw-evidence-ledger.json', 'utf8')),
);
const ledgerEntries = new Map(ledger.entries.map((entry) => [entry.evidenceId, entry]));
const root = process.env.RAWENGINE_PRIVATE_RAW_ROOT;
const requireAssets = process.argv.includes('--require-assets');
const failures = [];

if (requireAssets && root === undefined) {
  failures.push('RAWENGINE_PRIVATE_RAW_ROOT is required with --require-assets.');
}

for (const qualityCase of manifest.qualityCases) {
  const ledgerEntry = ledgerEntries.get(qualityCase.evidenceId);
  if (ledgerEntry === undefined) {
    failures.push(`${qualityCase.fixtureId}: missing private RAW evidence ledger entry ${qualityCase.evidenceId}.`);
    continue;
  }

  if (!ledgerEntry.expectedUse.includes('deblur')) {
    failures.push(`${qualityCase.fixtureId}: ledger entry must include deblur expectedUse.`);
  }
  if (ledgerEntry.artifactClass !== qualityCase.artifactClass) {
    failures.push(`${qualityCase.fixtureId}: artifactClass must match ledger entry.`);
  }
  if (ledgerEntry.status !== qualityCase.rightsStatus) {
    failures.push(`${qualityCase.fixtureId}: rightsStatus must mirror ledger status.`);
  }

  if (root !== undefined && ledgerEntry.localRelativePath !== undefined) {
    try {
      await access(resolve(root, ledgerEntry.localRelativePath));
    } catch {
      failures.push(`${qualityCase.fixtureId}: missing local RAW asset ${ledgerEntry.localRelativePath}.`);
    }
  }
}

if (failures.length > 0) {
  console.error('Deblur real RAW quality validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${manifest.qualityCases.length} deblur real RAW quality cases (schema-only public mode).`);
