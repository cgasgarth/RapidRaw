#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs';

import type { z } from 'zod';

import { albumTreeSchema } from '../../../src/schemas/albumSchemas.ts';
import { folderTreeListSchema } from '../../../src/schemas/folderTreeSchemas.ts';
import { parseTauriBoundaryLedger, type TauriBoundaryLedger } from '../../../src/schemas/tauriBoundaryLedgerSchemas.ts';
import { emptyTauriResponseSchema } from '../../../src/schemas/tauriResponseSchemas.ts';
import { parseTauriPayload } from '../../../src/utils/tauriSchemaInvoke.ts';

type TauriBoundaryEntry = TauriBoundaryLedger['entries'][number];

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const schemaByName = {
  albumTreeSchema,
  emptyTauriResponseSchema,
  folderTreeListSchema,
} satisfies Record<TauriBoundaryEntry['zodSchema'], z.ZodType<unknown>>;

const ledger = parseTauriBoundaryLedger(readJson('fixtures/validation/tauri-boundary-ledger.json'));
const appProperties = readFileSync('src/components/ui/AppProperties.tsx', 'utf8');
const failures: string[] = [];

const recordFailure = (message: string) => {
  failures.push(message);
};

for (const entry of ledger.entries) {
  if (!appProperties.includes(`${entry.invokeEnumMember} = '${entry.command}'`)) {
    recordFailure(`${entry.command}: Invokes.${entry.invokeEnumMember} mapping missing`);
  }

  for (const callSite of entry.tsCallSites) {
    if (!existsSync(callSite)) {
      recordFailure(`${entry.command}: missing call site ${callSite}`);
      continue;
    }

    const source = readFileSync(callSite, 'utf8');
    if (!source.includes(entry.invokeEnumMember)) recordFailure(`${entry.command}: ${callSite} missing invoke enum`);
    if (!source.includes('invokeWithSchema')) recordFailure(`${entry.command}: ${callSite} missing invokeWithSchema`);
    if (!source.includes(entry.zodSchema)) recordFailure(`${entry.command}: ${callSite} missing ${entry.zodSchema}`);
  }

  runParseFixture(entry);
}

if (failures.length > 0) {
  console.error(`tauri schema validation failed (${failures.length})`);
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`tauri schema validation ok (${ledger.entries.length} boundaries)`);

function runParseFixture(entry: TauriBoundaryEntry) {
  if (entry.positiveFixturePath === undefined || entry.negativeFixturePath === undefined) return;

  const schema = schemaByName[entry.zodSchema];
  parseTauriPayload(schema, readJson(entry.positiveFixturePath), `${entry.command} positive`);

  try {
    parseTauriPayload(schema, readJson(entry.negativeFixturePath), `${entry.command} negative`);
    recordFailure(`${entry.command}: negative fixture parsed unexpectedly`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(`Invalid Tauri payload for ${entry.command} negative`)) {
      recordFailure(`${entry.command}: negative fixture produced wrong error`);
    }
    if (message.length > 500) {
      recordFailure(`${entry.command}: negative fixture error is not bounded`);
    }
  }
}
