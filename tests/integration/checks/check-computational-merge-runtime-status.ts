#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { z } from 'zod';

import { parseComputationalMergeE2eProofManifest } from '../../../src/schemas/computationalMergeE2eProofSchemas.ts';
import { parseComputationalMergePrivateRunReportCollection } from '../../../src/schemas/computationalMergePrivateRunReportSchemas.ts';

const REPORT_PATH = 'docs/validation/computational-merge-runtime-status-2026-06-18.json';
const GENERATED_AT = '2026-06-18T00:00:00.000Z';

const caseSchema = z
  .object({
    featureFamily: z.enum(['hdr_merge', 'panorama_stitch', 'focus_stack', 'super_resolution']),
    fixtureId: z.string().trim().min(1),
    implementationIssue: z.number().int().positive(),
    proofStatus: z.enum([
      'manifest_only',
      'pending_private_assets',
      'runtime_apply_capable',
      'e2e_verified_private_assets',
    ]),
    publicRuntimeBridge: z
      .object({
        check: z.string().trim().min(1),
        status: z.literal('runtime_apply_capable'),
      })
      .strict(),
    runtimeReportPresent: z.boolean(),
    status: z.enum([
      'manifest_only',
      'pending_private_assets',
      'private_decode_smoke',
      'runtime_apply_capable',
      'e2e_verified_private_assets',
      'passed_private_raw_e2e',
    ]),
    uiIssue: z.number().int().positive(),
  })
  .strict();

const reportSchema = z
  .object({
    cases: z.array(caseSchema).min(4),
    checks: z.array(z.string().trim().min(1)).min(2),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(1809),
    privateRunReports: z.number().int().nonnegative(),
    proofCaseCount: z.number().int().min(4),
    proofHash: z.string().regex(/^[a-f0-9]{64}$/u),
    schemaVersion: z.literal(1),
    status: z.enum([
      'public_contract_private_assets_pending',
      'public_runtime_bridges_present_private_assets_pending',
      'private_reports_present',
    ]),
  })
  .strict()
  .superRefine((runtimeStatus, context) => {
    if (runtimeStatus.proofCaseCount !== runtimeStatus.cases.length) {
      context.addIssue({
        code: 'custom',
        message: 'proofCaseCount must match cases length.',
        path: ['proofCaseCount'],
      });
    }
    for (const family of ['hdr_merge', 'panorama_stitch', 'focus_stack', 'super_resolution'] as const) {
      if (!runtimeStatus.cases.some((entry) => entry.featureFamily === family)) {
        context.addIssue({
          code: 'custom',
          message: `Missing computational merge runtime status for ${family}.`,
          path: ['cases'],
        });
      }
    }
  });

const update = process.argv.includes('--update');

for (const command of [
  ['bun', 'tests/integration/checks/check-computational-merge-e2e-proof-manifest.ts'],
  ['bun', 'tests/integration/checks/check-computational-merge-private-run-reports.ts'],
  ['bun', 'scripts/run-hdr-real-raw-private-proof.ts'],
  ['bun', 'scripts/run-panorama-real-raw-private-proof.ts'],
  ['bun', 'scripts/run-focus-real-raw-private-proof.ts'],
  ['bun', 'scripts/run-sr-real-raw-private-proof.ts'],
  ['bun', 'run', 'check:hdr-ui-runtime-bridge'],
  ['bun', 'run', 'check:panorama-ui-runtime-bridge'],
  ['bun', 'run', 'check:focus-ui-runtime-bridge'],
  ['bun', 'run', 'check:sr-ui-runtime-bridge'],
]) {
  run(command);
}

const manifestText = await Bun.file('fixtures/validation/computational-merge-e2e-proof.json').text();
const reportsText = await Bun.file('fixtures/validation/computational-merge-private-run-reports.json').text();
const manifest = parseComputationalMergeE2eProofManifest(JSON.parse(manifestText));
const reports = parseComputationalMergePrivateRunReportCollection(JSON.parse(reportsText));
const reportsByFixtureId = new Map(reports.reports.map((report) => [report.fixtureId, report]));
const publicRuntimeBridgeByFeatureFamily = new Map([
  ['hdr_merge', 'bun run check:hdr-ui-runtime-bridge'],
  ['panorama_stitch', 'bun run check:panorama-ui-runtime-bridge'],
  ['focus_stack', 'bun run check:focus-ui-runtime-bridge'],
  ['super_resolution', 'bun run check:sr-ui-runtime-bridge'],
] as const);
const cases = manifest.proofCases.map((proofCase) => {
  const report = reportsByFixtureId.get(proofCase.fixtureId);
  const publicRuntimeCheck = publicRuntimeBridgeByFeatureFamily.get(proofCase.featureFamily);
  if (publicRuntimeCheck === undefined) {
    throw new Error(`Missing public runtime bridge check for ${proofCase.featureFamily}.`);
  }
  return {
    featureFamily: proofCase.featureFamily,
    fixtureId: proofCase.fixtureId,
    implementationIssue: proofCase.implementationIssue,
    proofStatus: proofCase.proofStatus,
    publicRuntimeBridge: {
      check: publicRuntimeCheck,
      status: 'runtime_apply_capable',
    },
    runtimeReportPresent: report !== undefined,
    status: report?.acceptanceStatus ?? proofCase.proofStatus,
    uiIssue: proofCase.uiIssue,
  };
});

const privateReportCount = reports.reports.length;
const status =
  privateReportCount === 0 ? 'public_runtime_bridges_present_private_assets_pending' : 'private_reports_present';
const report = reportSchema.parse({
  cases,
  checks: [
    'bun run check:computational-merge-e2e-proof-manifest',
    'bun run check:computational-merge-private-run-reports',
    'bun run check:hdr-real-raw-private-proof',
    'bun run check:panorama-real-raw-private-proof',
    'bun run check:focus-real-raw-private-proof',
    'bun run check:sr-real-raw-private-proof',
    'bun run check:hdr-ui-runtime-bridge',
    'bun run check:panorama-ui-runtime-bridge',
    'bun run check:focus-ui-runtime-bridge',
    'bun run check:sr-ui-runtime-bridge',
  ],
  generatedAt: GENERATED_AT,
  issue: 1809,
  privateRunReports: privateReportCount,
  proofCaseCount: manifest.proofCases.length,
  proofHash: hashString(
    JSON.stringify({
      manifestHash: hashString(manifestText),
      reportsHash: hashString(reportsText),
      status,
    }),
  ),
  schemaVersion: 1,
  status,
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('computational merge runtime status updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:computational-merge-runtime-status:update.`);
}

const existingReport = reportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(existingReport) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:computational-merge-runtime-status:update.`);
}

console.log(`computational merge runtime status ok (${status})`);

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
