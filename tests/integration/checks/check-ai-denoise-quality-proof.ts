#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import { isEligibleRealRun, parseAiDenoiseQualityReport } from '../../../src/schemas/aiDenoiseQualityReportSchemas.ts';

const REPORT_PATH = 'docs/validation/ai-denoise-quality-proof-2026-06-18.json';
const requireClosure = process.argv.includes('--require-closure');
const requireRuntime = process.argv.includes('--require-runtime');

const report = parseAiDenoiseQualityReport(await Bun.file(REPORT_PATH).json());
const eligibleRuns = report.validationCrops.filter(isEligibleRealRun);
const failures: string[] = [];

if (report.proofHash !== hashReport(report)) {
  failures.push(`${REPORT_PATH}: proofHash is stale.`);
}

if (report.status === 'harness_only' && eligibleRuns.length >= report.minEligibleRealRunsRequired) {
  failures.push(`${REPORT_PATH}: harness_only status must be promoted after enough eligible real runs exist.`);
}

if ((requireClosure || requireRuntime) && eligibleRuns.length < report.minEligibleRealRunsRequired) {
  failures.push(
    `requires ${report.minEligibleRealRunsRequired} real applied NIND crops; found ${eligibleRuns.length}.`,
  );
}

for (const crop of report.validationCrops) {
  const syntheticOrUnavailable =
    crop.source.kind === 'synthetic_control' ||
    crop.executionStatus === 'dry_run_only' ||
    crop.executionStatus === 'schema_only' ||
    crop.executionStatus === 'unavailable_provider';
  if (syntheticOrUnavailable && isEligibleRealRun(crop)) {
    failures.push(`${crop.cropId}: synthetic, dry-run, schema-only, or unavailable proof cannot be eligible.`);
  }

  for (const artifact of crop.artifacts) {
    if (!existsSync(artifact.path)) failures.push(`${crop.cropId}: missing artifact ${artifact.path}.`);
  }
}

if (failures.length > 0) {
  console.error(`ai denoise quality proof failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const closure = eligibleRuns.length >= report.minEligibleRealRunsRequired ? 'yes' : 'no';
console.log(`ai denoise quality proof ok eligible=${eligibleRuns.length} closure=${closure} status=${report.status}`);

function hashReport(value: typeof report): string {
  const { proofHash: _proofHash, ...hashableReport } = value;
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(hashableReport)).digest('hex');
}
