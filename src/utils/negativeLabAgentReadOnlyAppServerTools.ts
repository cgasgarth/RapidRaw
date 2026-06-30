import { z } from 'zod';

import type {
  NegativeLabAppServerCommand,
  NegativeLabDensitometerAppServerCommand,
  NegativeLabFrameHealthAppServerCommand,
  NegativeLabPlanRollNormalizationAppServerCommand,
  NegativeLabQcProofAppServerCommand,
  NegativeLabStockFamilyConversionAppServerCommand,
} from '../schemas/negativeLabAppServerSchemas';
import {
  negativeLabAppServerCommandSchema,
  negativeLabAppServerScopeSchema,
  negativeLabDensitometerAppServerCommandSchema,
  negativeLabFrameHealthAppServerCommandSchema,
  negativeLabPlanRollNormalizationAppServerCommandSchema,
  negativeLabQcProofAppServerCommandSchema,
  negativeLabStockFamilyConversionAppServerCommandSchema,
} from '../schemas/negativeLabAppServerSchemas';
import { NegativeLabAppServerCommandName } from './negativeLabAppServerCommandNames';
import {
  buildNegativeLabConversionPlanResult,
  buildNegativeLabDensitometerRouteResult,
  buildNegativeLabFrameHealthRouteResult,
  buildNegativeLabPlanRollNormalizationRouteResult,
  buildNegativeLabQcProofRouteResult,
  buildNegativeLabStockFamilyConversionRouteResult,
} from './negativeLabAppServerRoutes';
import { buildNegativeLabPlanHash } from './negativeLabPlanIdentity';

export const NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME = 'negativelab.inspect_readonly';
export const NEGATIVE_LAB_AGENT_CONVERSION_PLAN_TOOL_NAME = 'negativelab.plan_conversion_readonly';
export const NEGATIVE_LAB_AGENT_ROLL_NORMALIZATION_PLAN_TOOL_NAME = 'negativelab.plan_roll_normalization_readonly';
export const NEGATIVE_LAB_AGENT_QC_PROOF_TOOL_NAME = 'negativelab.qc_proof_readonly';
export const NEGATIVE_LAB_AGENT_STOCK_FAMILY_PLAN_TOOL_NAME = 'negativelab.plan_stock_family_readonly';

export const NEGATIVE_LAB_AGENT_READ_ONLY_TOOL_NAMES = [
  NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME,
  NEGATIVE_LAB_AGENT_CONVERSION_PLAN_TOOL_NAME,
  NEGATIVE_LAB_AGENT_ROLL_NORMALIZATION_PLAN_TOOL_NAME,
  NEGATIVE_LAB_AGENT_QC_PROOF_TOOL_NAME,
  NEGATIVE_LAB_AGENT_STOCK_FAMILY_PLAN_TOOL_NAME,
] as const;

const requestBaseSchema = z
  .object({
    requestId: z.string().trim().min(1),
    selectedScope: negativeLabAppServerScopeSchema,
    selectedFrameIds: z.array(z.string().trim().min(1)).optional(),
    sessionId: z.string().trim().min(1).optional(),
  })
  .strict();

export const negativeLabAgentInspectRequestSchema = requestBaseSchema
  .extend({
    densitometer: negativeLabDensitometerAppServerCommandSchema.optional(),
    frameHealth: negativeLabFrameHealthAppServerCommandSchema,
  })
  .strict();

export const negativeLabAgentConversionPlanRequestSchema = requestBaseSchema
  .extend({
    conversion: negativeLabAppServerCommandSchema,
  })
  .strict();

export const negativeLabAgentRollNormalizationPlanRequestSchema = requestBaseSchema
  .extend({
    rollNormalization: negativeLabPlanRollNormalizationAppServerCommandSchema,
  })
  .strict();

export const negativeLabAgentQcProofRequestSchema = requestBaseSchema
  .extend({
    qc: negativeLabQcProofAppServerCommandSchema,
  })
  .strict();

export const negativeLabAgentStockFamilyPlanRequestSchema = requestBaseSchema
  .extend({
    stockFamily: negativeLabStockFamilyConversionAppServerCommandSchema,
  })
  .strict();

const readOnlyProofSchema = z
  .object({
    deterministic: z.literal(true),
    generatedFrom: z.literal('src/utils/negativeLabAgentReadOnlyAppServerTools.ts'),
    mutates: z.literal(false),
    readOnly: z.literal(true),
    stateMutationProhibited: z.literal(true),
    underlyingCommandNames: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

const parameterDiffSchema = z
  .object({
    path: z.string().trim().min(1),
    value: z.unknown(),
  })
  .strict();

const agentReadOnlyResponseBaseSchema = z
  .object({
    deterministicHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    proof: readOnlyProofSchema,
    requestId: z.string().trim().min(1),
    selectedScope: negativeLabAppServerScopeSchema,
    sessionId: z.string().trim().min(1).nullable(),
    toolName: z.enum(NEGATIVE_LAB_AGENT_READ_ONLY_TOOL_NAMES),
  })
  .strict();

export const negativeLabAgentInspectResponseSchema = agentReadOnlyResponseBaseSchema
  .extend({
    activeFrameId: z.string().trim().min(1).nullable(),
    densitometerReadout: z.unknown().nullable(),
    frameHealthReport: z.unknown(),
    frameIds: z.array(z.string().trim().min(1)),
    toolName: z.literal(NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

export const negativeLabAgentConversionPlanResponseSchema = agentReadOnlyResponseBaseSchema
  .extend({
    affectedFrameIds: z.array(z.string().trim().min(1)),
    conversionPlan: z.unknown(),
    parameterDiff: z.array(parameterDiffSchema),
    profileProvenanceHash: z.string().trim().min(1),
    toolName: z.literal(NEGATIVE_LAB_AGENT_CONVERSION_PLAN_TOOL_NAME),
  })
  .strict();

export const negativeLabAgentRollNormalizationPlanResponseSchema = agentReadOnlyResponseBaseSchema
  .extend({
    affectedFrameIds: z.array(z.string().trim().min(1)),
    parameterDiff: z.array(parameterDiffSchema),
    plan: z.unknown(),
    planId: z.string().trim().min(1),
    toolName: z.literal(NEGATIVE_LAB_AGENT_ROLL_NORMALIZATION_PLAN_TOOL_NAME),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

export const negativeLabAgentQcProofResponseSchema = agentReadOnlyResponseBaseSchema
  .extend({
    contactSheetArtifact: z
      .object({
        artifactId: z.string().trim().min(1),
        contentHash: z.string().trim().min(1),
        proofId: z.string().trim().min(1),
      })
      .strict(),
    qcProofBundle: z.unknown(),
    report: z.unknown(),
    toolName: z.literal(NEGATIVE_LAB_AGENT_QC_PROOF_TOOL_NAME),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

export const negativeLabAgentStockFamilyPlanResponseSchema = agentReadOnlyResponseBaseSchema
  .extend({
    affectedFrameIds: z.array(z.string().trim().min(1)),
    parameterDiff: z.array(parameterDiffSchema),
    profileProvenanceHash: z.string().trim().min(1),
    stockFamilyPlan: z.unknown(),
    toolName: z.literal(NEGATIVE_LAB_AGENT_STOCK_FAMILY_PLAN_TOOL_NAME),
  })
  .strict();

export type NegativeLabAgentInspectRequest = z.infer<typeof negativeLabAgentInspectRequestSchema>;
export type NegativeLabAgentConversionPlanRequest = z.infer<typeof negativeLabAgentConversionPlanRequestSchema>;
export type NegativeLabAgentRollNormalizationPlanRequest = z.infer<
  typeof negativeLabAgentRollNormalizationPlanRequestSchema
>;
export type NegativeLabAgentQcProofRequest = z.infer<typeof negativeLabAgentQcProofRequestSchema>;
export type NegativeLabAgentStockFamilyPlanRequest = z.infer<typeof negativeLabAgentStockFamilyPlanRequestSchema>;

const stableReadOnlyHash = (payload: unknown): string => `fnv1a32:${buildNegativeLabPlanHash(JSON.stringify(payload))}`;

const readOnlyProof = (underlyingCommandNames: string[]) =>
  readOnlyProofSchema.parse({
    deterministic: true,
    generatedFrom: 'src/utils/negativeLabAgentReadOnlyAppServerTools.ts',
    mutates: false,
    readOnly: true,
    stateMutationProhibited: true,
    underlyingCommandNames,
  });

const warningCodesFromFrameHealth = (frameHealthReport: ReturnType<typeof buildNegativeLabFrameHealthRouteResult>) =>
  [...new Set(frameHealthReport.frames.flatMap((frame) => frame.warningCodes))].sort((left, right) =>
    left.localeCompare(right),
  );

const conversionParameterDiff = (command: NegativeLabAppServerCommand, params: Record<string, unknown>) => [
  { path: '/presetId', value: command.presetId },
  { path: '/outputFormat', value: command.outputFormat },
  { path: '/suffix', value: command.suffix },
  { path: '/sampleRect', value: command.sampleRect },
  { path: '/params/base_fog_sample', value: params['base_fog_sample'] },
  { path: '/params/exposure', value: params['exposure'] },
  { path: '/params/contrast', value: params['contrast'] },
  { path: '/params/red_weight', value: params['red_weight'] },
  { path: '/params/green_weight', value: params['green_weight'] },
  { path: '/params/blue_weight', value: params['blue_weight'] },
];

export const inspectNegativeLabAgentReadOnly = (request: NegativeLabAgentInspectRequest) => {
  const parsedRequest = negativeLabAgentInspectRequestSchema.parse(request);
  const frameHealthReport = buildNegativeLabFrameHealthRouteResult(
    parsedRequest.frameHealth as NegativeLabFrameHealthAppServerCommand,
  );
  const densitometerReadout =
    parsedRequest.densitometer === undefined
      ? null
      : buildNegativeLabDensitometerRouteResult(parsedRequest.densitometer as NegativeLabDensitometerAppServerCommand);
  const responsePayload = {
    activeFrameId: frameHealthReport.activeFrameId,
    densitometerReadout,
    frameIds: frameHealthReport.frames.map((frame) => frame.frameId),
    warningCodes: warningCodesFromFrameHealth(frameHealthReport),
  };

  return negativeLabAgentInspectResponseSchema.parse({
    ...responsePayload,
    deterministicHash: stableReadOnlyHash(responsePayload),
    frameHealthReport,
    proof: readOnlyProof([NegativeLabAppServerCommandName.FrameHealth, NegativeLabAppServerCommandName.Densitometer]),
    requestId: parsedRequest.requestId,
    selectedScope: parsedRequest.selectedScope,
    sessionId: parsedRequest.sessionId ?? null,
    toolName: NEGATIVE_LAB_AGENT_INSPECT_TOOL_NAME,
  });
};

export const planNegativeLabAgentConversionReadOnly = (request: NegativeLabAgentConversionPlanRequest) => {
  const parsedRequest = negativeLabAgentConversionPlanRequestSchema.parse(request);
  const conversionPlan = buildNegativeLabConversionPlanResult(parsedRequest.conversion);
  const parameterDiff = conversionParameterDiff(parsedRequest.conversion, conversionPlan.params);
  const responsePayload = {
    affectedFrameIds: parsedRequest.selectedFrameIds ?? conversionPlan.paths,
    parameterDiff,
    profileProvenanceHash: conversionPlan.profileProvenanceHash,
  };

  return negativeLabAgentConversionPlanResponseSchema.parse({
    ...responsePayload,
    conversionPlan,
    deterministicHash: stableReadOnlyHash({ ...responsePayload, conversionPlan }),
    proof: readOnlyProof([NegativeLabAppServerCommandName.ConversionPlan]),
    requestId: parsedRequest.requestId,
    selectedScope: parsedRequest.selectedScope,
    sessionId: parsedRequest.sessionId ?? null,
    toolName: NEGATIVE_LAB_AGENT_CONVERSION_PLAN_TOOL_NAME,
  });
};

export const planNegativeLabAgentRollNormalizationReadOnly = (
  request: NegativeLabAgentRollNormalizationPlanRequest,
) => {
  const parsedRequest = negativeLabAgentRollNormalizationPlanRequestSchema.parse(request);
  const plan = buildNegativeLabPlanRollNormalizationRouteResult(
    parsedRequest.rollNormalization as NegativeLabPlanRollNormalizationAppServerCommand,
  );
  const parameterDiff = [
    ...plan.exposureOverrides.overrides.map((override) => ({
      path: `/frames/${override.frameId}/exposureOffset`,
      value: override.exposureOffset,
    })),
    ...plan.rgbBalanceOverrides.overrides.map((override) => ({
      path: `/frames/${override.frameId}/rgbBalanceOffset`,
      value: override.rgbBalanceOffset,
    })),
    { path: '/mode', value: plan.mode },
    { path: '/preserveCreativeAdjustments', value: plan.preserveCreativeAdjustments },
  ];
  const planId = `negative_lab_roll_normalization_${buildNegativeLabPlanHash(JSON.stringify(plan))}`;
  const responsePayload = {
    affectedFrameIds: plan.affectedFrameIds,
    parameterDiff,
    planId,
    warningCodes: plan.warningCodes,
  };

  return negativeLabAgentRollNormalizationPlanResponseSchema.parse({
    ...responsePayload,
    deterministicHash: stableReadOnlyHash({ ...responsePayload, plan }),
    plan,
    proof: readOnlyProof([NegativeLabAppServerCommandName.PlanRollNormalization]),
    requestId: parsedRequest.requestId,
    selectedScope: parsedRequest.selectedScope,
    sessionId: parsedRequest.sessionId ?? null,
    toolName: NEGATIVE_LAB_AGENT_ROLL_NORMALIZATION_PLAN_TOOL_NAME,
  });
};

export const buildNegativeLabAgentQcProofReadOnly = (request: NegativeLabAgentQcProofRequest) => {
  const parsedRequest = negativeLabAgentQcProofRequestSchema.parse(request);
  const qcProofBundle = buildNegativeLabQcProofRouteResult(parsedRequest.qc as NegativeLabQcProofAppServerCommand);
  const { artifact, report } = qcProofBundle;
  const warningCodes = [...new Set(artifact.warnings.flatMap((warning) => warning.code))].sort((left, right) =>
    left.localeCompare(right),
  );
  const responsePayload = {
    contactSheetArtifact: {
      artifactId: artifact.contactSheet.artifact.artifactId,
      contentHash: artifact.contactSheet.artifact.contentHash,
      proofId: artifact.proofId,
    },
    warningCodes,
  };

  return negativeLabAgentQcProofResponseSchema.parse({
    ...responsePayload,
    deterministicHash: stableReadOnlyHash({ ...responsePayload, qcProofBundle }),
    proof: readOnlyProof([NegativeLabAppServerCommandName.QcProof]),
    qcProofBundle,
    report,
    requestId: parsedRequest.requestId,
    selectedScope: parsedRequest.selectedScope,
    sessionId: parsedRequest.sessionId ?? null,
    toolName: NEGATIVE_LAB_AGENT_QC_PROOF_TOOL_NAME,
  });
};

export const planNegativeLabAgentStockFamilyReadOnly = (request: NegativeLabAgentStockFamilyPlanRequest) => {
  const parsedRequest = negativeLabAgentStockFamilyPlanRequestSchema.parse(request);
  const stockFamilyPlan = buildNegativeLabStockFamilyConversionRouteResult(
    parsedRequest.stockFamily as NegativeLabStockFamilyConversionAppServerCommand,
  );
  const parameterDiff = conversionParameterDiff(
    {
      ...parsedRequest.stockFamily,
      presetId: stockFamilyPlan.conversionPlan.presetId,
    },
    stockFamilyPlan.conversionPlan.params,
  );
  const responsePayload = {
    affectedFrameIds: parsedRequest.selectedFrameIds ?? stockFamilyPlan.conversionPlan.paths,
    parameterDiff,
    profileProvenanceHash: stockFamilyPlan.conversionPlan.profileProvenanceHash,
  };

  return negativeLabAgentStockFamilyPlanResponseSchema.parse({
    ...responsePayload,
    deterministicHash: stableReadOnlyHash({ ...responsePayload, stockFamilyPlan }),
    proof: readOnlyProof([NegativeLabAppServerCommandName.StockFamilyConversion]),
    requestId: parsedRequest.requestId,
    selectedScope: parsedRequest.selectedScope,
    sessionId: parsedRequest.sessionId ?? null,
    stockFamilyPlan,
    toolName: NEGATIVE_LAB_AGENT_STOCK_FAMILY_PLAN_TOOL_NAME,
  });
};
