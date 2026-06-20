#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { negativeLabStockMetadataCatalogSchema } from '../../../src/schemas/negativeLabStockMetadataCatalogSchemas.ts';

const sourceUrl = new URL('../../../src/data/negativeLabStockMetadataCatalog.json', import.meta.url);
const coverageUrl = new URL(
  '../../../docs/validation/negative-lab-stock-metadata-coverage-2026-06-19.json',
  import.meta.url,
);
const updateCoverage = process.argv.includes('--update');

const coverageEntrySchema = z
  .object({
    claimPolicy: z.literal('reference_metadata_no_emulation_no_match_claim'),
    displayName: z.string().trim().min(1),
    doesNotProve: z.array(z.string().trim().min(1)).min(6),
    entryId: z.string().trim().min(1),
    processFamily: z.string().trim().min(1),
    runtimeStatus: z.literal('metadata_only_not_applicable'),
    stockClass: z.string().trim().min(1),
    suggestedGenericPresetId: z.string().trim().min(1).nullable(),
  })
  .strict();

const coverageSchema = z
  .object({
    byStockClass: z.array(
      z
        .object({
          count: z.number().int().positive(),
          stockClass: z.string().trim().min(1),
        })
        .strict(),
    ),
    claimBoundary: z.literal('metadata_only_no_runtime_emulation_or_match_claim'),
    entries: z.array(coverageEntrySchema).min(1),
    generatedFrom: z.literal('src/data/negativeLabStockMetadataCatalog.json'),
    requiredNonClaims: z.array(z.string().trim().min(1)).min(6),
    schemaVersion: z.literal(1),
    totalEntries: z.number().int().positive(),
    validationCommand: z.literal('bun run check:negative-lab-stock-metadata-coverage'),
  })
  .strict();

const sourceCatalog = negativeLabStockMetadataCatalogSchema.parse(JSON.parse(await readFile(sourceUrl, 'utf8')));
const requiredNonClaims = [
  'colorimetric_match',
  'licensed_profile',
  'manufacturer_endorsement',
  'measured_profile',
  'runtime_application',
  'stock_emulation',
];
const byStockClass = [...Map.groupBy(sourceCatalog.entries, (entry) => entry.stockClass).entries()]
  .map(([stockClass, entries]) => ({
    count: entries.length,
    stockClass,
  }))
  .toSorted((left, right) => left.stockClass.localeCompare(right.stockClass));

const expectedCoverage = coverageSchema.parse({
  byStockClass,
  claimBoundary: 'metadata_only_no_runtime_emulation_or_match_claim',
  entries: sourceCatalog.entries.map((entry) => ({
    claimPolicy: entry.claimPolicy,
    displayName: entry.displayName,
    doesNotProve: entry.doesNotProve,
    entryId: entry.entryId,
    processFamily: entry.processFamily,
    runtimeStatus: entry.runtimeStatus,
    stockClass: entry.stockClass,
    suggestedGenericPresetId: entry.suggestedGenericPresetId,
  })),
  generatedFrom: 'src/data/negativeLabStockMetadataCatalog.json',
  requiredNonClaims,
  schemaVersion: 1,
  totalEntries: sourceCatalog.entries.length,
  validationCommand: 'bun run check:negative-lab-stock-metadata-coverage',
});

const expectedText = `${JSON.stringify(expectedCoverage, null, 2)}\n`;
if (updateCoverage) {
  await writeFile(coverageUrl, expectedText);
  console.log(`negative lab stock metadata coverage updated (${expectedCoverage.totalEntries})`);
  process.exit(0);
}

const actualCoverage = coverageSchema.parse(JSON.parse(await readFile(coverageUrl, 'utf8')));
if (JSON.stringify(actualCoverage) !== JSON.stringify(expectedCoverage)) {
  throw new Error(
    'Negative Lab stock metadata coverage artifact is stale. Run bun run check:negative-lab-stock-metadata-coverage:update.',
  );
}

for (const entry of expectedCoverage.entries) {
  for (const requiredNonClaim of requiredNonClaims) {
    if (!entry.doesNotProve.includes(requiredNonClaim)) {
      throw new Error(`${entry.entryId}: coverage artifact missing non-claim ${requiredNonClaim}.`);
    }
  }
}

console.log(`negative lab stock metadata coverage ok (${expectedCoverage.totalEntries})`);
