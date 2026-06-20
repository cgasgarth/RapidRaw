#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { buildPanoramaRuntimeDryRunV1 } from '../../../packages/rawengine-schema/src/panoramaRuntimePlan.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../scripts/lib/computational-proof-budgets.ts';

const REPORT_PATH = 'docs/validation/panorama-graph-reference-proof-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');
const sourceFrames = [0, 1, 2, 3].map((sourceIndex) => ({
  contentHash: `sha256:panorama-graph-source-${sourceIndex}`,
  expectedOffsetX: sourceIndex * 40,
  expectedOffsetY: sourceIndex === 2 ? 1 : 0,
  graphRevision: 'graph_rev_panorama_reference_source',
  height: 50,
  sourceIndex,
  width: 80,
}));

const selectedEdgeSchema = z
  .object({
    fromSourceIndex: z.number().int().nonnegative(),
    overlapAreaPx: z.number().int().positive(),
    qualityRank: z.number().int().positive(),
    qualityScore: z.number(),
    toSourceIndex: z.number().int().nonnegative(),
  })
  .strict();
const reportSchema = z
  .object({
    cases: z
      .array(
        z
          .object({
            candidateEdgeCount: z.literal(6),
            pairwiseMatchCount: z.literal(3),
            referenceSelectionReason: z.literal('projected_center_source'),
            referenceSourceIndex: z.literal(1),
            selectedEdges: z.array(selectedEdgeSchema).length(3),
            selectionMode: z.literal('quality_ranked_spanning_graph_v1'),
          })
          .strict(),
      )
      .length(1),
    issue: z.literal(2294),
    schemaVersion: z.literal(1),
    validationMode: z.literal('panorama_graph_reference_selection'),
    validationStatus: z.literal('synthetic_runtime_metadata_gate'),
  })
  .strict();

const dryRun = buildPanoramaRuntimeDryRunV1({
  command: {
    actor: { id: 'agent_rawengine', kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Panorama graph proof validates non-mutating graph metadata.',
      state: 'not_required',
    },
    commandId: 'command_panorama_graph_reference',
    commandType: 'computationalMerge.createPanorama',
    correlationId: 'corr_panorama_graph_reference',
    dryRun: true,
    expectedGraphRevision: 'graph_rev_panorama_reference',
    parameters: {
      boundaryMode: 'auto_crop',
      exposureNormalization: 'auto',
      lensCorrectionPolicy: 'required_before_stitch',
      maxPreviewDimensionPx: 1200,
      memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
      outputName: 'Synthetic Graph Reference Panorama',
      projection: 'rectilinear',
      qualityPreference: 'balanced',
      sources: sourceFrames.map((frame) => ({
        colorSpaceHint: 'camera_rgb',
        exposureEv: 0,
        imageId: `img_panorama_graph_${frame.sourceIndex}`,
        imagePath: `/synthetic/panorama/graph-${frame.sourceIndex}.dng`,
        rawDefaultsApplied: true,
        role: 'panorama_tile',
        sourceIndex: frame.sourceIndex,
      })),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: 'project_panorama_graph', kind: 'project' },
  },
  connectedSourceIndices: sourceFrames.map((frame) => frame.sourceIndex),
  outputArtifactId: 'artifact_panorama_graph_reference',
  previewArtifactId: 'preview_panorama_graph_reference',
  seed: 'rawengine-panorama-graph-reference-v1',
  sourceFrames,
});
const graph = dryRun.provenance.alignment.graph;
const selectedEdges = graph.selectedEdges;

if (!selectedEdges.every((edge) => edge.overlapAreaPx > 0)) {
  throw new Error('Panorama graph proof expected selected spanning edges to use overlapping pairs.');
}
if (new Set(selectedEdges.map((edge) => edge.qualityRank)).size !== selectedEdges.length) {
  throw new Error('Panorama graph proof expected unique edge quality ranks.');
}

const report = reportSchema.parse({
  cases: [
    {
      candidateEdgeCount: graph.candidateEdgeCount,
      pairwiseMatchCount: dryRun.provenance.alignment.pairwiseMatches.length,
      referenceSelectionReason: graph.referenceSelectionReason,
      referenceSourceIndex: graph.referenceSourceIndex,
      selectedEdges,
      selectionMode: graph.selectionMode,
    },
  ],
  issue: 2294,
  schemaVersion: 1,
  validationMode: 'panorama_graph_reference_selection',
  validationStatus: 'synthetic_runtime_metadata_gate',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;

if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:panorama-graph-reference-proof:update.`);
  }
}

console.log(`panorama graph reference proof ok (${report.cases.length} cases)`);
