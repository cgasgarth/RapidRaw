#!/usr/bin/env bun

import { z } from 'zod';

import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  RawEngineAppServerHostToolName,
  type RawEngineAppServerToolDispatchResponse,
} from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST_DATA } from '../../../../src/utils/computational-merge/computationalMergeAppServerRouteManifestData.ts';
import { getComputationalMergeAppServerRoutePairSummary } from '../../../../src/utils/computational-merge/computationalMergeAppServerRoutePairs.ts';
import { handleRawEngineAppServerHostRequestAsync } from '../../../../src/utils/rawEngineAppServerHost.ts';

const familySchema = z.enum(['hdr', 'panorama', 'focus_stack', 'super_resolution']);
const dispatchResultSchema = z
  .object({
    dispatchStatus: z.enum(['completed', 'rejected']),
    message: z.string().optional(),
    result: z.unknown().optional(),
  })
  .passthrough();
const dryRunToolResultSchema = z.object({
  acceptedDryRunPlanHash: z.string().trim().min(1),
  dryRun: z.object({
    dryRunResult: z.object({
      mergePlan: z.object({
        family: familySchema,
        outputDimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }),
        planId: z.string().trim().min(1),
      }),
      mutates: z.literal(false),
      previewArtifacts: z.array(
        z.object({
          artifactId: z.string().trim().min(1),
          contentHash: z.string().trim().min(1).optional(),
          dimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).optional(),
        }),
      ),
    }),
  }),
  kind: z.literal('dry_run'),
  toolName: z.string().trim().min(1),
});
const applyToolResultSchema = z.object({
  apply: z.object({
    mutationResult: z
      .object({
        appliedGraphRevision: z.string().trim().min(1),
        derivedAssetId: z.string().trim().min(1),
        outputArtifacts: z.array(
          z
            .object({
              artifactId: z.string().trim().min(1),
              contentHash: z.string().trim().min(1),
              dimensions: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
  }),
  kind: z.literal('apply'),
  toolName: z.string().trim().min(1),
});
const openResultSchema = z.object({
  appliedGraphRevision: z.string().trim().min(1),
  derivedSourceId: z.string().trim().min(1),
  family: familySchema,
  mutates: z.literal(true),
  openPath: z.string().trim().min(1),
  outputArtifactId: z.string().trim().min(1),
  receiptId: z.string().trim().min(1),
});

const families = familySchema.options;
const manifestFamilies = new Set(
  COMPUTATIONAL_MERGE_APP_SERVER_ROUTE_MANIFEST_DATA.routes.map((route) => route.family),
);
for (const family of families) {
  if (!manifestFamilies.has(family)) throw new Error(`Manifest is missing computational family ${family}.`);
}

const proofs = [];
for (const family of families) {
  const routePair = getComputationalMergeAppServerRoutePairSummary(family);
  const dryRunCommand = buildCommand(family, true);
  const applyWithoutAcceptedPlan = buildCommand(family, false);

  await expectRejected(
    `${family} apply without accepted dry-run`,
    dispatch(routePair.applyToolName, applyWithoutAcceptedPlan, `${family}_apply_without_plan`),
  );

  await expectRejected(
    `${family} open before current apply`,
    dispatch(
      routePair.openDerivedSourceToolName,
      buildOpenRequest(family, applyWithoutAcceptedPlan),
      `${family}_open_before_apply`,
    ),
  );

  const dryRunResponse = await expectCompleted(
    `${family} dry-run`,
    dispatch(routePair.dryRunToolName, dryRunCommand, `${family}_dry_run`),
  );
  const dryRun = dryRunToolResultSchema.parse(dryRunResponse.result);
  if (dryRun.toolName !== routePair.dryRunToolName) throw new Error(`${family} dry-run returned wrong tool name.`);
  if (dryRun.dryRun.dryRunResult.mergePlan.family !== family)
    throw new Error(`${family} dry-run returned wrong family.`);
  const previewProof = dryRun.dryRun.dryRunResult.previewArtifacts.find(
    (artifact) => artifact.contentHash !== undefined && artifact.dimensions !== undefined,
  );
  if (previewProof === undefined) throw new Error(`${family} dry-run did not return a hashed preview artifact.`);

  await expectRejected(
    `${family} apply with stale plan hash`,
    dispatch(
      routePair.applyToolName,
      buildCommand(family, false, {
        acceptedDryRunPlanHash: 'sha256:stale-plan-hash',
        acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
      }),
      `${family}_apply_stale_hash`,
    ),
    'unaccepted',
  );

  const applyCommand = buildCommand(family, false, {
    acceptedDryRunPlanHash: dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRun.dryRunResult.mergePlan.planId,
  });
  const applyResponse = await expectCompleted(
    `${family} apply`,
    dispatch(routePair.applyToolName, applyCommand, `${family}_apply`),
  );
  const apply = applyToolResultSchema.parse(applyResponse.result);
  const outputArtifact = apply.apply.mutationResult.outputArtifacts[0];
  if (outputArtifact === undefined) throw new Error(`${family} apply did not return an output artifact.`);

  await expectRejected(
    `${family} open with stale graph`,
    dispatch(
      routePair.openDerivedSourceToolName,
      buildOpenRequest(family, applyCommand, apply.apply.mutationResult, {
        currentGraphRevision: `${apply.apply.mutationResult.appliedGraphRevision}:stale`,
      }),
      `${family}_open_stale_graph`,
    ),
  );

  await expectRejected(
    `${family} open with stale receipt`,
    dispatch(
      routePair.openDerivedSourceToolName,
      buildOpenRequest(family, applyCommand, apply.apply.mutationResult, {
        receipt: { staleReasons: ['source_graph_revision_changed'], staleState: 'stale' },
      }),
      `${family}_open_stale_receipt`,
    ),
  );

  const openResponse = await expectCompleted(
    `${family} open derived source`,
    dispatch(
      routePair.openDerivedSourceToolName,
      buildOpenRequest(family, applyCommand, apply.apply.mutationResult),
      `${family}_open`,
    ),
  );
  const open = openResultSchema.parse(openResponse.result);
  if (open.family !== family) throw new Error(`${family} open-derived-source returned wrong family.`);

  proofs.push({
    family,
    openDerivedSourceId: open.derivedSourceId,
    outputArtifactId: outputArtifact.artifactId,
    outputContentHash: outputArtifact.contentHash,
    outputDimensions: outputArtifact.dimensions,
    planId: dryRun.dryRun.dryRunResult.mergePlan.planId,
    previewArtifactId: previewProof.artifactId,
    previewContentHash: previewProof.contentHash,
  });
}

console.log(`computational merge app-server route e2e ok (${proofs.length} families)`);

async function dispatch(
  runtimeToolName: string,
  args: unknown,
  requestId: string,
): Promise<RawEngineAppServerToolDispatchResponse> {
  const response = await handleRawEngineAppServerHostRequestAsync({
    arguments: args,
    requestId: `request_computational_e2e_${requestId}`,
    runtimeToolName,
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  });
  return response as RawEngineAppServerToolDispatchResponse;
}

async function expectCompleted(label: string, responsePromise: Promise<RawEngineAppServerToolDispatchResponse>) {
  const response = dispatchResultSchema.parse(await responsePromise);
  if (response.dispatchStatus !== 'completed') {
    throw new Error(`${label} rejected unexpectedly: ${JSON.stringify(response, null, 2)}.`);
  }
  return response;
}

async function expectRejected(
  label: string,
  responsePromise: Promise<RawEngineAppServerToolDispatchResponse>,
  messageFragment?: string,
): Promise<void> {
  const response = dispatchResultSchema.parse(await responsePromise);
  if (response.dispatchStatus !== 'rejected') throw new Error(`${label} completed unexpectedly.`);
  if (messageFragment !== undefined && !response.message?.includes(messageFragment)) {
    throw new Error(`${label} rejected with unexpected message: ${response.message ?? 'missing message'}.`);
  }
}

function buildCommand(
  family: z.infer<typeof familySchema>,
  dryRun: boolean,
  acceptedPlan?: { acceptedDryRunPlanHash: string; acceptedDryRunPlanId: string },
) {
  const suffix = `${family}_${dryRun ? 'dry_run' : 'apply'}`;
  const approval = dryRun
    ? {
        approvalClass: ApprovalClass.PreviewOnly,
        reason: `Computational ${family} E2E dry-run.`,
        state: 'not_required',
      }
    : {
        approvalClass: ApprovalClass.EditApply,
        reason: `Computational ${family} E2E apply.`,
        state: 'approved',
      };
  const common = {
    actor: { id: 'agent_rawengine', kind: 'agent' },
    approval,
    commandId: `command_computational_e2e_${suffix}`,
    correlationId: `corr_computational_e2e_${suffix}`,
    dryRun,
    expectedGraphRevision: `graph_rev_computational_e2e_${family}`,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: `project_computational_e2e_${family}`, kind: 'project' },
  };
  const accepted = acceptedPlan === undefined ? {} : acceptedPlan;

  switch (family) {
    case 'hdr':
      return {
        ...common,
        commandType: 'computationalMerge.createHdr',
        parameters: {
          ...accepted,
          alignmentMode: 'translation',
          bracketValidation: 'required',
          deghosting: 'off',
          maxPreviewDimensionPx: 1200,
          mergeStrategy: 'scene_linear_radiance',
          outputName: 'Computational E2E HDR',
          qualityPreference: 'balanced',
          sources: [-2, 0, 2].map((exposureEv, sourceIndex) => ({
            colorSpaceHint: 'camera_rgb',
            exposureEv,
            imageId: `img_computational_e2e_hdr_${sourceIndex}`,
            imagePath: `/synthetic/hdr/computational-e2e-${sourceIndex}.dng`,
            rawDefaultsApplied: true,
            role: 'hdr_bracket',
            sourceIndex,
          })),
          toneMapPreview: false,
        },
      };
    case 'panorama':
      return {
        ...common,
        commandType: 'computationalMerge.createPanorama',
        parameters: {
          ...accepted,
          boundaryMode: 'auto_crop',
          exposureNormalization: 'auto',
          lensCorrectionPolicy: 'required_before_stitch',
          maxPreviewDimensionPx: 1200,
          memoryBudgetBytes: 256_000_000,
          outputName: 'Computational E2E Panorama',
          projection: 'rectilinear',
          qualityPreference: 'balanced',
          sources: [0, 1, 2].map((sourceIndex) => ({
            colorSpaceHint: 'camera_rgb',
            exposureEv: sourceIndex === 1 ? 0.25 : 0,
            imageId: `img_computational_e2e_panorama_${sourceIndex}`,
            imagePath: `/synthetic/panorama/computational-e2e-${sourceIndex}.dng`,
            rawDefaultsApplied: true,
            role: 'panorama_tile',
            sourceIndex,
          })),
        },
      };
    case 'focus_stack':
      return {
        ...common,
        commandType: 'computationalMerge.createFocusStack',
        parameters: {
          ...accepted,
          alignmentMode: 'translation',
          blendMethod: 'weighted_sharpness',
          maxPreviewDimensionPx: 1200,
          memoryBudgetBytes: 256_000_000,
          outputName: 'Computational E2E Focus Stack',
          qualityPreference: 'best',
          retouchLayerPolicy: 'generate_retouch_layer',
          sources: [0, 1, 2].map((sourceIndex) => ({
            colorSpaceHint: 'camera_rgb',
            focusDistanceMm: 180 + sourceIndex * 60,
            imageId: `img_computational_e2e_focus_${sourceIndex}`,
            imagePath: `/synthetic/focus/computational-e2e-${sourceIndex}.dng`,
            rawDefaultsApplied: true,
            role: 'focus_slice',
            sourceIndex,
          })),
        },
      };
    case 'super_resolution':
      return {
        ...common,
        commandType: 'computationalMerge.createSuperResolution',
        parameters: {
          ...accepted,
          alignmentMode: 'translation',
          detailPolicy: 'conservative',
          maxPreviewDimensionPx: 1200,
          mode: 'multi_image',
          outputName: 'Computational E2E Super Resolution',
          outputScale: 2,
          qualityPreference: 'best',
          sources: [0, 1, 2, 3].map((sourceIndex) => ({
            colorSpaceHint: 'camera_rgb',
            exposureEv: 0,
            imageId: `img_computational_e2e_sr_${sourceIndex}`,
            imagePath: `/synthetic/sr/computational-e2e-${sourceIndex}.dng`,
            rawDefaultsApplied: true,
            role: 'sr_frame',
            sourceIndex,
          })),
        },
      };
  }
}

function buildOpenRequest(
  family: z.infer<typeof familySchema>,
  command: ReturnType<typeof buildCommand>,
  mutationResult = buildPlaceholderMutationResult(family),
  overrides: {
    currentGraphRevision?: string;
    receipt?: { staleReasons?: string[]; staleState?: 'current' | 'stale' | 'unknown' };
  } = {},
) {
  const outputArtifact = mutationResult.outputArtifacts[0] ?? {
    artifactId: mutationResult.derivedAssetId,
    contentHash: `sha256:${family}-placeholder-output`,
    dimensions: { height: 1, width: 1 },
  };
  return {
    actor: command.actor,
    approval: command.approval,
    command,
    correlationId: `corr_computational_e2e_${family}_open`,
    currentGraphRevision: overrides.currentGraphRevision ?? mutationResult.appliedGraphRevision,
    mutationResult,
    receipt: {
      acceptedDryRunPlanHash: command.parameters.acceptedDryRunPlanHash ?? 'sha256:missing-plan-hash',
      acceptedDryRunPlanId: command.parameters.acceptedDryRunPlanId ?? 'missing-plan-id',
      family,
      openInEditorAction: {
        path: `/synthetic/${family}/derived-source.dng`,
        state: 'available',
      },
      outputArtifactId: mutationResult.derivedAssetId,
      outputContentHash: outputArtifact.contentHash,
      outputPath: `/synthetic/${family}/derived-output.tif`,
      provenanceSidecarPath: `/synthetic/${family}/derived-output.json`,
      receiptId: `receipt_computational_e2e_${family}`,
      settingsHash: `sha256:${family}-settings`,
      sourceGraphRevisions: [mutationResult.sourceGraphRevision],
      staleState: 'current',
      ...overrides.receipt,
    },
    requestId: `request_computational_e2e_${family}_open`,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  };
}

function buildPlaceholderMutationResult(family: z.infer<typeof familySchema>) {
  return {
    appliedGraphRevision: `graph_rev_computational_e2e_${family}:placeholder_apply`,
    changedNodeIds: [`node_computational_e2e_${family}`],
    commandId: `command_computational_e2e_${family}_placeholder_apply`,
    commandType:
      family === 'hdr'
        ? 'computationalMerge.createHdr'
        : family === 'panorama'
          ? 'computationalMerge.createPanorama'
          : family === 'focus_stack'
            ? 'computationalMerge.createFocusStack'
            : 'computationalMerge.createSuperResolution',
    correlationId: `corr_computational_e2e_${family}_placeholder_apply`,
    derivedAssetId: `artifact_computational_e2e_${family}_placeholder_output`,
    dryRun: false,
    mutates: true,
    outputArtifacts: [
      {
        artifactId: `artifact_computational_e2e_${family}_placeholder_output`,
        contentHash: `sha256:${family}-placeholder-output`,
        dimensions: { height: 1, width: 1 },
        kind: 'derived_raw',
        storage: 'sidecar_artifact',
      },
    ],
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceGraphRevision: `graph_rev_computational_e2e_${family}`,
    undoRevision: `undo_computational_e2e_${family}`,
    warnings: [],
  };
}
