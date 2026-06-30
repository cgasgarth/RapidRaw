#!/usr/bin/env bun

import { existsSync } from 'node:fs';

import {
  isEligibleRealRun,
  parseAiDenoiseQualityReport,
} from '../../../../src/schemas/aiDenoiseQualityReportSchemas.ts';

const REPORT_PATH = 'docs/validation/proofs/detail-retouch/ai-denoise-quality-proof-2026-06-18.json';
const requireClosure = process.argv.includes('--require-closure');
const requireRuntime = process.argv.includes('--require-runtime');

const report = parseAiDenoiseQualityReport(await Bun.file(REPORT_PATH).json());
const eligibleRuns = report.validationCrops.filter(isEligibleRealRun);
const runtimeBackedRuns = report.validationCrops.filter((crop) => crop.executionStatus === 'applied_nind_runtime');
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

if (runtimeBackedRuns.length === 0) {
  failures.push(`${REPORT_PATH}: must include at least one runtime-backed crop proof.`);
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

  if (crop.executionStatus === 'applied_nind_runtime') {
    if (crop.outputContentHash === null) {
      failures.push(`${crop.cropId}: runtime-backed crop must record an output hash.`);
    }
    if (crop.metrics.changedPixelCount <= 0) {
      failures.push(`${crop.cropId}: runtime-backed crop must change output pixels.`);
    }
    if (crop.metrics.edgeEnergyRatio >= 1) {
      failures.push(`${crop.cropId}: runtime-backed crop must reduce edge energy.`);
    }
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
console.log(
  `ai denoise quality proof ok runtime=${runtimeBackedRuns.length} eligible=${eligibleRuns.length} closure=${closure} status=${report.status}`,
);

function hashReport(value: typeof report): string {
  const { proofHash: _proofHash, ...hashableReport } = value;
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(hashableReport)).digest('hex');
}
