#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  buildPanoramaHomographyDltDiagnosticsV1,
  type PanoramaHomographyDltDiagnosticsV1,
  type PanoramaHomographyPointPairV1,
  panoramaHomographyDltDiagnosticCodeV1Schema,
  panoramaHomographyDltDiagnosticsV1Schema,
} from '../../../packages/rawengine-schema/src/panoramaHomographyDiagnostics.ts';
import { buildPanoramaRuntimeDryRunV1 } from '../../../packages/rawengine-schema/src/panoramaRuntimePlan.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../scripts/lib/computational-proof-budgets.ts';

const REPORT_PATH = 'docs/validation/proofs/panorama/panorama-homography-diagnostics-proof-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');
const RUNTIME_STATUS = 'synthetic_homography_dlt_diagnostic_proof';

const proofCaseSchema = z
  .object({
    actionableMessage: z.string().trim().min(1),
    case: z.string().trim().min(1),
    conditionNumber: z.number().positive().nullable(),
    correspondenceCount: z.number().int().nonnegative(),
    designMatrixRank: z.number().int().nonnegative(),
    failureCode: panoramaHomographyDltDiagnosticCodeV1Schema.optional(),
    homographyScaleAbs: z.number().nonnegative(),
    minimumProjectiveScaleAbs: z.number().nonnegative(),
    normalizedResidualRms: z.number().nonnegative(),
    provenance: z
      .object({
        boundedFailureMode: z.enum(['not_applicable', 'actionable_error']),
        diagnosticSchema: z.literal('panoramaHomographyDltDiagnosticsV1'),
        runtimeStatus: z.literal(RUNTIME_STATUS),
      })
      .strict(),
    status: panoramaHomographyDltDiagnosticsV1Schema.shape.status,
    warningCodes: z.array(panoramaHomographyDltDiagnosticCodeV1Schema),
  })
  .strict();

const proofReportSchema = z
  .object({
    cases: z.array(proofCaseSchema).min(1),
    doesNotProve: z.array(z.enum(['real_raw_e2e', 'raw_decode_quality', 'ui_e2e'])).min(1),
    issue: z.literal(2296),
    schemaVersion: z.literal(1),
    validationMode: z.literal('panorama_homography_dlt_runtime_diagnostics'),
  })
  .strict();

type ProofCase = z.infer<typeof proofCaseSchema>;

const failures: string[] = [];
const runtimeDryRun = buildPanoramaRuntimeDryRunV1({
  command: buildDryRunCommand(),
  connectedSourceIndices: [0, 1, 2],
  outputArtifactId: 'artifact_panorama_homography_diagnostics_output',
  previewArtifactId: 'artifact_panorama_homography_diagnostics_preview',
  seed: 'rawengine-panorama-homography-diagnostics-v1',
  sourceFrames: sourceFrames(),
});

const runtimeDiagnostics = runtimeDryRun.provenance.alignment.pairwiseMatches.map((match) => match.dltDiagnostics);
if (runtimeDiagnostics.length !== 2)
  failures.push(`runtime: expected 2 pairwise diagnostics, got ${runtimeDiagnostics.length}`);
for (const [index, diagnostic] of runtimeDiagnostics.entries()) {
  assertDiagnostic(index === 0 ? 'runtime-first-pair' : 'runtime-second-pair', diagnostic, 'accepted');
}

const collinear = buildPanoramaHomographyDltDiagnosticsV1({
  homography3x3: translationHomography3x3(12, 3),
  pointPairs: [
    { source: [0, 0], target: [12, 3] },
    { source: [10, 0], target: [22, 3] },
    { source: [20, 0], target: [32, 3] },
    { source: [30, 0], target: [42, 3] },
  ],
});
assertDiagnostic('collinear-rank-deficient', collinear, 'rejected', 'dlt_rank_deficient');

const scaleDegenerate = buildPanoramaHomographyDltDiagnosticsV1({
  homography3x3: [1, 0, 12, 0, 1, 3, 0, 0, 0],
  pointPairs: rectangleTranslationPointPairs(71, 47, 12, 3),
});
assertDiagnostic('scale-degenerate', scaleDegenerate, 'rejected', 'homography_scale_degenerate');

const report = proofReportSchema.parse({
  cases: [
    ...runtimeDiagnostics.map((diagnostic, index) =>
      proofCase(index === 0 ? 'runtime-first-pair' : 'runtime-second-pair', diagnostic),
    ),
    proofCase('collinear-rank-deficient', collinear),
    proofCase('scale-degenerate', scaleDegenerate),
  ],
  doesNotProve: ['real_raw_e2e', 'raw_decode_quality', 'ui_e2e'],
  issue: 2296,
  schemaVersion: 1,
  validationMode: 'panorama_homography_dlt_runtime_diagnostics',
});

const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = proofReportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    failures.push(
      `${REPORT_PATH} is stale; run bun tests/integration/checks/check-panorama-homography-diagnostics.ts --update`,
    );
  }
}

if (failures.length > 0) {
  console.error(`panorama homography diagnostics failed (${failures.length})`);
  for (const failure of failures.slice(0, 10)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`panorama homography diagnostics ok (${report.cases.length} cases)`);

function proofCase(caseName: string, diagnostic: PanoramaHomographyDltDiagnosticsV1): ProofCase {
  return {
    actionableMessage: diagnostic.actionableMessage,
    case: caseName,
    conditionNumber: diagnostic.conditionNumber,
    correspondenceCount: diagnostic.correspondenceCount,
    designMatrixRank: diagnostic.designMatrixRank,
    ...(diagnostic.failureCode === undefined ? {} : { failureCode: diagnostic.failureCode }),
    homographyScaleAbs: diagnostic.homographyScaleAbs,
    minimumProjectiveScaleAbs: diagnostic.minimumProjectiveScaleAbs,
    normalizedResidualRms: diagnostic.normalizedResidualRms,
    provenance: {
      boundedFailureMode: diagnostic.status === 'rejected' ? 'actionable_error' : 'not_applicable',
      diagnosticSchema: 'panoramaHomographyDltDiagnosticsV1',
      runtimeStatus: RUNTIME_STATUS,
    },
    status: diagnostic.status,
    warningCodes: diagnostic.warningCodes,
  };
}

function assertDiagnostic(
  label: string,
  diagnostic: PanoramaHomographyDltDiagnosticsV1,
  expectedStatus: PanoramaHomographyDltDiagnosticsV1['status'],
  expectedFailureCode?: z.infer<typeof panoramaHomographyDltDiagnosticCodeV1Schema>,
): void {
  if (diagnostic.status !== expectedStatus) {
    failures.push(`${label}: expected status ${expectedStatus}, got ${diagnostic.status}`);
  }
  if (expectedFailureCode !== undefined && diagnostic.failureCode !== expectedFailureCode) {
    failures.push(`${label}: expected failure ${expectedFailureCode}, got ${diagnostic.failureCode ?? 'none'}`);
  }
  if (diagnostic.actionableMessage.length === 0) {
    failures.push(`${label}: diagnostic message must be actionable and non-empty`);
  }
}

function rectangleTranslationPointPairs(
  width: number,
  height: number,
  x: number,
  y: number,
): PanoramaHomographyPointPairV1[] {
  return [
    { source: [0, 0], target: [x, y] },
    { source: [width, 0], target: [width + x, y] },
    { source: [0, height], target: [x, height + y] },
    { source: [width, height], target: [width + x, height + y] },
  ];
}

function translationHomography3x3(
  x: number,
  y: number,
): [number, number, number, number, number, number, number, number, number] {
  return [1, 0, x, 0, 1, y, 0, 0, 1];
}

function sourceFrames() {
  return [
    {
      contentHash: 'sha256:panorama-homography-diagnostics-source-0',
      expectedOffsetX: 0,
      expectedOffsetY: 0,
      graphRevision: 'graph_rev_panorama_homography_diagnostics_source',
      height: 48,
      sourceIndex: 0,
      width: 72,
    },
    {
      contentHash: 'sha256:panorama-homography-diagnostics-source-1',
      expectedOffsetX: 48,
      expectedOffsetY: 2,
      graphRevision: 'graph_rev_panorama_homography_diagnostics_source',
      height: 48,
      sourceIndex: 1,
      width: 72,
    },
    {
      contentHash: 'sha256:panorama-homography-diagnostics-source-2',
      expectedOffsetX: 96,
      expectedOffsetY: -1,
      graphRevision: 'graph_rev_panorama_homography_diagnostics_source',
      height: 48,
      sourceIndex: 2,
      width: 72,
    },
  ];
}

function buildDryRunCommand() {
  const frames = sourceFrames();
  return {
    actor: { id: 'agent_rawengine', kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Panorama homography diagnostics proof validates synthetic dry-run metadata.',
      state: 'not_required',
    },
    commandId: 'command_panorama_homography_diagnostics',
    commandType: 'computationalMerge.createPanorama',
    correlationId: 'corr_panorama_homography_diagnostics',
    dryRun: true,
    expectedGraphRevision: 'graph_rev_panorama_homography_diagnostics',
    parameters: {
      boundaryMode: 'auto_crop',
      exposureNormalization: 'auto',
      lensCorrectionPolicy: 'required_before_stitch',
      maxPreviewDimensionPx: 1200,
      memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
      outputName: 'Synthetic Homography Diagnostics Panorama',
      projection: 'cylindrical',
      qualityPreference: 'balanced',
      sources: frames.map((frame) => ({
        colorSpaceHint: 'camera_rgb',
        exposureEv: 0,
        imageId: `img_panorama_homography_diagnostics_${frame.sourceIndex}`,
        imagePath: `/synthetic/panorama/homography-diagnostics-${frame.sourceIndex}.dng`,
        rawDefaultsApplied: true,
        role: 'panorama_tile',
        sourceIndex: frame.sourceIndex,
      })),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: 'project_panorama_homography_diagnostics', kind: 'project' },
  };
}
