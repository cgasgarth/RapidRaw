#!/usr/bin/env bun

import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parsePrivateRawEvidenceLedger } from '../src/schemas/privateRawEvidenceSchemas.ts';

const requireAssets = process.argv.includes('--require-assets');
const ledgerPath = resolve('fixtures/detail/private-raw-evidence-ledger.json');
const ledger = parsePrivateRawEvidenceLedger(JSON.parse(await readFile(ledgerPath, 'utf8')));

const availableEntries = ledger.entries.filter((entry) => entry.status === 'private_asset_available');
const root = process.env.RAWENGINE_PRIVATE_RAW_ROOT;

if (requireAssets && root === undefined) {
  throw new Error('RAWENGINE_PRIVATE_RAW_ROOT is required when running with --require-assets.');
}

if (root !== undefined) {
  const missingPaths = [];
  for (const entry of availableEntries) {
    if (entry.localRelativePath === undefined) {
      continue;
    }

    try {
      await access(resolve(root, entry.localRelativePath));
    } catch {
      missingPaths.push(`${entry.evidenceId}: ${entry.localRelativePath}`);
    }
  }

  if (missingPaths.length > 0) {
    throw new Error(`Missing private RAW evidence assets:\n${missingPaths.join('\n')}`);
  }
}

const plannedEntries = ledger.entries.filter((entry) => entry.status === 'planned_private_capture');
const mode = root === undefined ? 'schema-only public mode' : `local asset mode (${availableEntries.length} active)`;
console.log(
  `Validated ${ledger.entries.length} private RAW evidence entries (${plannedEntries.length} planned, ${mode}).`,
);
