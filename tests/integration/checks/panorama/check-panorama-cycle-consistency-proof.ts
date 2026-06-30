#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { buildPanoramaRuntimeDryRunV1 } from '../../../../packages/rawengine-schema/src/panorama/panoramaRuntimePlan.ts';
import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../../scripts/lib/computational/proof-budgets.ts';

const REPORT_PATH = 'docs/validation/proofs/panorama/panorama-cycle-consistency-proof-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');
const sourceFrames = [0, 1, 2].map((sourceIndex) => ({
  contentHash: `sha256:panorama-cycle-source-${sourceIndex}`,
  expectedOffsetX: sourceIndex * 40,
  expectedOffsetY: 0,
  graphRevision: 'graph_rev_panorama_cycle_source',
  height: 40,
  sourceIndex,
  width: 100,
}));

const rejectedEdgeSchema = z
  .object({
    fromSourceIndex: z.literal(0),
    qualityRank: z.number().int().positive(),
    reason: z.literal('cycle_residual_exceeded'),
    residualPx: z.number().min(10).max(10),
    toSourceIndex: z.literal(2),
  })
  .strict();
const reportSchema = z
  .object({
    cases: z
      .array(
        z
          .object({
            candidateEdgeCount: z.literal(3),
            rejectedEdgeCount: z.literal(1),
            rejectedEdges: z.array(rejectedEdgeSchema).length(1),
            residualThresholdPx: z.literal(2),
            selectedEdgeCount: z.literal(2),
            validationMode: z.literal('translation_cycle_residual_v1'),
          })
          .strict(),
      )
      .length(1),
    issue: z.literal(2293),
    schemaVersion: z.literal(1),
    validationMode: z.literal('panorama_cycle_consistency_rejection'),
    validationStatus: z.literal('synthetic_runtime_metadata_gate'),
  })
  .strict();

const dryRun = buildPanoramaRuntimeDryRunV1({
  candidateTransformOverrides: [
    {
      fromSourceIndex: 0,
      reason: 'synthetic_cycle_inconsistency_fixture',
      toSourceIndex: 2,
      translationPx: { x: 70, y: 0 },
    },
  ],
  command: {
    actor: { id: 'agent_rawengine', kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Panorama cycle proof validates non-mutating graph rejection metadata.',
      state: 'not_required',
    },
    commandId: 'command_panorama_cycle_consistency',
    commandType: 'computationalMerge.createPanorama',
    correlationId: 'corr_panorama_cycle_consistency',
    dryRun: true,
    expectedGraphRevision: 'graph_rev_panorama_cycle',
    parameters: {
      boundaryMode: 'auto_crop',
      exposureNormalization: 'auto',
      lensCorrectionPolicy: 'required_before_stitch',
      maxPreviewDimensionPx: 1200,
      memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
      outputName: 'Synthetic Cycle Consistency Panorama',
      projection: 'rectilinear',
      qualityPreference: 'balanced',
      sources: sourceFrames.map((frame) => ({
        colorSpaceHint: 'camera_rgb',
        exposureEv: 0,
        imageId: `img_panorama_cycle_${frame.sourceIndex}`,
        imagePath: `/synthetic/panorama/cycle-${frame.sourceIndex}.dng`,
        rawDefaultsApplied: true,
        role: 'panorama_tile',
        sourceIndex: frame.sourceIndex,
      })),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: 'project_panorama_cycle', kind: 'project' },
  },
  connectedSourceIndices: sourceFrames.map((frame) => frame.sourceIndex),
  outputArtifactId: 'artifact_panorama_cycle_consistency',
  previewArtifactId: 'preview_panorama_cycle_consistency',
  seed: 'rawengine-panorama-cycle-consistency-v1',
  sourceFrames,
});
const graph = dryRun.provenance.alignment.graph;
const cycleConsistency = graph.cycleConsistency;

if (graph.selectedEdges.some((edge) => edge.fromSourceIndex === 0 && edge.toSourceIndex === 2)) {
  throw new Error('Panorama cycle proof expected inconsistent direct edge to be rejected, not selected.');
}

const report = reportSchema.parse({
  cases: [
    {
      candidateEdgeCount: graph.candidateEdgeCount,
      rejectedEdgeCount: cycleConsistency.rejectedEdgeCount,
      rejectedEdges: cycleConsistency.rejectedEdges,
      residualThresholdPx: cycleConsistency.residualThresholdPx,
      selectedEdgeCount: graph.selectedEdgeCount,
      validationMode: cycleConsistency.validationMode,
    },
  ],
  issue: 2293,
  schemaVersion: 1,
  validationMode: 'panorama_cycle_consistency_rejection',
  validationStatus: 'synthetic_runtime_metadata_gate',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;

if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:panorama-cycle-consistency-proof:update.`);
  }
}

console.log(`panorama cycle consistency proof ok (${report.cases.length} cases)`);
