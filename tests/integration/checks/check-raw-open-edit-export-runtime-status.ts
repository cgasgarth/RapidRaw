#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { z } from 'zod';

import { parseRawOpenEditExportProofManifest } from '../../../src/schemas/rawOpenEditExportProofSchemas.ts';
import { parseRawOpenEditExportRunReportCollection } from '../../../src/schemas/rawOpenEditExportRunReportSchemas.ts';

const REPORT_PATH = 'docs/validation/raw-open-edit-export-runtime-status-2026-06-18.json';
const GENERATED_AT = '2026-06-18T00:00:00.000Z';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const reportSchema = z
  .object({
    checks: z.array(z.string().trim().min(1)),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(1376),
    proofHash: hashSchema,
    schemaVersion: z.literal(1),
    status: z.enum(['public_contract_private_assets_pending', 'private_reports_present']),
    summary: z.object({
      commandWrapperTyped: z.literal(true),
      manifestProofCases: z.number().int().positive(),
      privateRunReports: z.number().int().nonnegative(),
      runtimeStatusForHtmlReview: z.string().trim().min(1),
    }),
  })
  .strict();

const update = process.argv.includes('--update');
for (const command of [
  ['bun', 'tests/integration/checks/check-raw-open-edit-export-proof.ts'],
  ['bun', 'tests/integration/checks/check-raw-open-edit-export-command-wrapper.ts'],
  ['bun', 'tests/integration/checks/check-raw-open-edit-export-run-reports.ts'],
]) {
  run(command);
}

const manifestText = await Bun.file('fixtures/validation/raw-open-edit-export-proof.json').text();
const runReportsText = await Bun.file('fixtures/validation/raw-open-edit-export-run-reports.json').text();
const manifest = parseRawOpenEditExportProofManifest(JSON.parse(manifestText));
const runReports = parseRawOpenEditExportRunReportCollection(JSON.parse(runReportsText));
const status = runReports.reports.length > 0 ? 'private_reports_present' : 'public_contract_private_assets_pending';
const summary = {
  commandWrapperTyped: true,
  manifestProofCases: manifest.proofCases.length,
  privateRunReports: runReports.reports.length,
  runtimeStatusForHtmlReview:
    status === 'private_reports_present'
      ? 'Private RAW run reports are present; HTML review can summarize runtime proof artifacts.'
      : 'Public repo has typed command and manifest checks; private RAW artifacts remain required before #1376 can close.',
};
const report = reportSchema.parse({
  checks: [
    'bun run check:raw-open-edit-export-proof',
    'bun run check:raw-open-edit-export-command-wrapper',
    'bun run check:raw-open-edit-export-run-reports',
  ],
  generatedAt: GENERATED_AT,
  issue: 1376,
  proofHash: hashString(
    JSON.stringify({
      manifestHash: hashString(manifestText),
      runReportsHash: hashString(runReportsText),
      status,
      summary,
    }),
  ),
  schemaVersion: 1,
  status,
  summary,
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('raw open/edit/export runtime status updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:raw-open-edit-export-runtime-status:update.`);
}

const existingReport = reportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:raw-open-edit-export-runtime-status:update.`);
}

console.log(`raw open/edit/export runtime status ok (${status})`);

function run(command: string[]): void {
  const result = Bun.spawnSync(command, { stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) {
    console.error(`${command.join(' ')} failed`);
    console.error(
      [new TextDecoder().decode(result.stdout), new TextDecoder().decode(result.stderr)]
        .join('\n')
        .split('\n')
        .slice(-20)
        .join('\n'),
    );
    process.exit(result.exitCode);
  }
}

function hashString(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex');
}
