#!/usr/bin/env bun

import {
  aiDenoiseQualityReportSchema,
  isEligibleRealRun,
  parseAiDenoiseQualityReport,
  type AiDenoiseQualityCrop,
  type AiDenoiseQualityReport,
} from '../../../src/schemas/aiDenoiseQualityReportSchemas.ts';
import { collectProofContractFailures } from '../../../src/schemas/proofLevelSemanticsSchemas.ts';

const proofContractReportPaths = [
  'docs/validation/command-replay-render-proof-2026-06-20.json',
  'docs/validation/selective-color-command-proof-2026-06-20.json',
  'fixtures/film-simulation/film-look-preview-export-parity.json',
  'docs/validation/ai-denoise-quality-proof-2026-06-18.json',
] as const;
const aiDenoiseReportPath = 'docs/validation/ai-denoise-quality-proof-2026-06-18.json';
const failures: string[] = [];

for (const path of proofContractReportPaths) {
  failures.push(...collectProofContractFailures(path, await readJson(path)));
}

const aiDenoiseReport = parseAiDenoiseQualityReport(await readJson(aiDenoiseReportPath));
failures.push(...collectAiDenoiseEligibilityFailures(aiDenoiseReportPath, aiDenoiseReport));

if (process.argv.includes('--self-test')) {
  const invalidIndependentClaim = {
    doesNotProve: ['real_raw_decode'],
    proofEntrypoints: {
      export: 'renderSyntheticPixels',
      preview: 'renderSyntheticPixels',
    },
    proofLevel: 'runtime_quality_harness',
    runtimeStatus: 'independent_preview_export_parity',
  };
  if (collectProofContractFailures('self-test', invalidIndependentClaim).length === 0) {
    failures.push('self-test did not reject independent parity overclaim with shared entrypoints.');
  }

  const invalidRuntimeClosureClaim = aiDenoiseQualityReportSchema.safeParse({
    ...aiDenoiseReport,
    status: 'eligible_real_run',
    validationCrops: [
      buildIneligibleRuntimeClaim(
        aiDenoiseReport.validationCrops[1] ?? aiDenoiseReport.validationCrops[0],
        'schema_only',
      ),
      buildIneligibleRuntimeClaim(
        aiDenoiseReport.validationCrops[1] ?? aiDenoiseReport.validationCrops[0],
        'dry_run_only',
      ),
    ],
  });
  if (invalidRuntimeClosureClaim.success) {
    failures.push('self-test did not reject schema-only/dry-run records marked as eligible runtime proof.');
  }
}

if (failures.length > 0) {
  console.error(`proof-level semantics failed (${failures.length})`);
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('proof-level semantics ok');

async function readJson(path: string): Promise<unknown> {
  return await Bun.file(path).json();
}

function collectAiDenoiseEligibilityFailures(path: string, report: AiDenoiseQualityReport): string[] {
  const reportFailures: string[] = [];

  for (const crop of report.validationCrops) {
    const ineligibleRuntimeStatus =
      crop.source.kind === 'synthetic_control' ||
      crop.executionStatus === 'dry_run_only' ||
      crop.executionStatus === 'schema_only' ||
      crop.executionStatus === 'unavailable_provider';

    if (ineligibleRuntimeStatus && isEligibleRealRun(crop)) {
      reportFailures.push(`${path} ${crop.cropId}: synthetic, dry-run, schema-only, or unavailable proof is eligible.`);
    }
  }

  return reportFailures;
}

function buildIneligibleRuntimeClaim(
  crop: AiDenoiseQualityCrop,
  executionStatus: 'dry_run_only' | 'schema_only',
): AiDenoiseQualityCrop {
  const hash = '0'.repeat(64);

  return {
    ...crop,
    artifacts: [
      { hash, kind: 'before_crop', path: 'docs/validation/self-test-before.png', role: 'before' },
      { hash, kind: 'after_crop', path: 'docs/validation/self-test-after.png', role: 'after' },
      { hash, kind: 'diff_heatmap', path: 'docs/validation/self-test-diff.png', role: 'diff' },
      { hash, kind: 'contact_sheet', path: 'docs/validation/self-test-contact.png', role: 'contact' },
    ],
    executionStatus,
    outputContentHash: `sha256:${hash}`,
    source: {
      ...crop.source,
      fixtureSourceHash: hash,
      kind: 'public_raw',
      sourceUrl: 'https://example.com/self-test.ARW',
    },
  };
}
