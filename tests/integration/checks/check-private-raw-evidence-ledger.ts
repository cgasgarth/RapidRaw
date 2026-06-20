#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parsePrivateRawEvidenceLedger } from '../../../src/schemas/privateRawEvidenceSchemas.ts';

const requireAssets = process.argv.includes('--require-assets');
const ledgerPath = resolve('fixtures/detail/private-raw-evidence-ledger.json');
const ledgerJson: unknown = JSON.parse(await readFile(ledgerPath, 'utf8'));
const ledger = parsePrivateRawEvidenceLedger(ledgerJson);

const availableEntries = ledger.entries.filter((entry) => entry.status === 'private_asset_available');
const root = process.env.RAWENGINE_PRIVATE_RAW_ROOT;

if (requireAssets && root === undefined) {
  throw new Error('RAWENGINE_PRIVATE_RAW_ROOT is required when running with --require-assets.');
}

if (root !== undefined) {
  const failures: string[] = [];
  for (const entry of availableEntries) {
    if (entry.localRelativePath === undefined) {
      continue;
    }

    const assetPath = resolve(root, entry.localRelativePath);
    try {
      await access(assetPath);
    } catch {
      failures.push(`${entry.evidenceId}: missing ${entry.localRelativePath}`);
      continue;
    }

    if (entry.fileSha256 !== undefined) {
      const actualSha256 = `sha256:${createHash('sha256')
        .update(await readFile(assetPath))
        .digest('hex')}`;
      if (actualSha256 !== entry.fileSha256) {
        failures.push(`${entry.evidenceId}: expected ${entry.fileSha256}, got ${actualSha256}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Private RAW evidence asset check failed:\n${failures.join('\n')}`);
  }
}

const plannedEntries = ledger.entries.filter((entry) => entry.status === 'planned_private_capture');
const familyCounts = new Map<string, number>();
for (const entry of ledger.entries) {
  familyCounts.set(entry.featureFamily, (familyCounts.get(entry.featureFamily) ?? 0) + 1);
}

const mode = root === undefined ? 'schema-only public mode' : `local asset mode (${availableEntries.length} active)`;
console.log(
  `private RAW evidence ok (${ledger.entries.length} entries, ${plannedEntries.length} planned, ${familyCounts.size} families, ${mode})`,
);
