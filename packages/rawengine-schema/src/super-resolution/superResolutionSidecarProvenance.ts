import { z } from 'zod';

import {
  type DerivedArtifactInvalidationInput,
  deriveArtifactInvalidationReasons,
} from '../derivedArtifactInvalidation.js';
import {
  type ArtifactHandleV1,
  type ComputationalMergeCommandEnvelopeV1,
  computationalMergeCommandEnvelopeV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
  type SuperResolutionArtifactV1,
  type SuperResolutionInvalidationReasonV1,
  superResolutionArtifactV1Schema,
  superResolutionInvalidationReasonV1Schema,
} from '../rawEngineSchemas.js';

import type { SuperResolutionRuntimeProvenanceV1 } from './superResolutionRuntimePlan.js';

type SuperResolutionApplyCommandV1 = Extract<
  ComputationalMergeCommandEnvelopeV1,
  { commandType: 'computationalMerge.createSuperResolution' }
>;

export const superResolutionSidecarEnvelopeV1Schema = z.looseObject({
  rawEngine: z
    .looseObject({
      superResolutionArtifacts: z.array(superResolutionArtifactV1Schema).optional(),
    })
    .optional(),
});

export type SuperResolutionSidecarEnvelopeV1 = z.infer<typeof superResolutionSidecarEnvelopeV1Schema>;

export interface BuildSuperResolutionArtifactSidecarRecordOptions {
  actualPeakMemoryBytes?: number;
  actualRuntimeMs?: number;
  command: SuperResolutionApplyCommandV1;
  createdAt: string;
  humanReviewStatus?: SuperResolutionArtifactV1['validationSummary']['humanReviewStatus'];
  outputArtifact: ArtifactHandleV1;
  outputColorSpace?: string;
  previewArtifacts: ArtifactHandleV1[];
  provenance: SuperResolutionRuntimeProvenanceV1;
  warningCodes?: SuperResolutionArtifactV1['warningCodes'];
}

export interface SuperResolutionArtifactCurrentStateV1 extends DerivedArtifactInvalidationInput {
  detailPolicy: SuperResolutionArtifactV1['detailPolicy'];
  engine: SuperResolutionArtifactV1['engine'];
  reconstructionMode: SuperResolutionArtifactV1['reconstructionMode'];
  requestedAlignmentMode: SuperResolutionArtifactV1['requestedAlignmentMode'];
  requestedOutputScale: SuperResolutionArtifactV1['requestedOutputScale'];
  resolvedAlignmentMode: SuperResolutionArtifactV1['resolvedAlignmentMode'];
}

export const buildSuperResolutionArtifactSidecarRecordV1 = ({
  actualPeakMemoryBytes,
  actualRuntimeMs,
  command,
  createdAt,
  humanReviewStatus = 'pending',
  outputArtifact,
  outputColorSpace,
  previewArtifacts,
  provenance,
  warningCodes,
}: BuildSuperResolutionArtifactSidecarRecordOptions): SuperResolutionArtifactV1 => {
  const parsedCommand = computationalMergeCommandEnvelopeV1Schema.parse(command);
  if (parsedCommand.commandType !== 'computationalMerge.createSuperResolution') {
    throw new Error('SR sidecar provenance requires a computationalMerge.createSuperResolution command.');
  }
  if (parsedCommand.dryRun) {
    throw new Error('SR sidecar provenance records require an apply command.');
  }

  const acceptedDryRunPlanHash = parsedCommand.parameters.acceptedDryRunPlanHash;
  const acceptedDryRunPlanId = parsedCommand.parameters.acceptedDryRunPlanId;
  if (acceptedDryRunPlanHash === undefined || acceptedDryRunPlanId === undefined) {
    throw new Error('SR sidecar provenance records require accepted dry-run plan provenance.');
  }

  const sourceState = provenance.sourceState.map((source) => ({
    contentHash: source.contentHash,
    graphRevision: source.graphRevision,
    sourceIndex: source.sourceIndex,
  }));
  const warnings =
    warningCodes ?? normalizeSuperResolutionWarningCodes(['human_review_required', ...deriveWarningCodes(provenance)]);
  const resolvedOutputColorSpace =
    outputColorSpace ?? parsedCommand.parameters.sources[0]?.colorSpaceHint ?? 'camera_linear_rgb';

  return superResolutionArtifactV1Schema.parse({
    artifactId: `artifact_record_${outputArtifact.artifactId}`,
    createdAt,
    decisionStatus: 'eligible_for_apply',
    detailPolicy: provenance.detailPolicy,
    dryRun: {
      acceptedDryRunPlanHash,
      acceptedDryRunPlanId,
    },
    engine: {
      backendType: 'local_cpu',
      engineId: provenance.engineId,
      engineVersion: provenance.engineVersion,
    },
    family: 'super_resolution',
    outputArtifact,
    outputColorSpace: resolvedOutputColorSpace,
    previewArtifacts,
    supportMap: {
      artifactId: provenance.supportMap.artifactId,
      coverageRatio: provenance.supportMap.coverageRatio,
      ...(provenance.supportMap.downgradeReason === undefined
        ? {}
        : { downgradeReason: provenance.supportMap.downgradeReason }),
      effectiveScale: provenance.supportMap.effectiveScale,
      requestedScale: provenance.supportMap.requestedScale,
      reviewStatus: provenance.supportMap.reviewStatus,
      weakSupportRatio: provenance.supportMap.weakSupportRatio,
    },
    qualityPreference: parsedCommand.parameters.qualityPreference,
    reconstructionMode: provenance.reconstructionMode,
    requestedAlignmentMode: provenance.requestedAlignmentMode,
    requestedOutputScale: provenance.requestedOutputScale,
    resolvedAlignmentMode: provenance.resolvedAlignmentMode,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sourceImageRefs: parsedCommand.parameters.sources,
    sourceState,
    staleState: {
      checkedAt: createdAt,
      invalidationReasons: [],
      state: 'current',
    },
    validationSummary: {
      actualPeakMemoryBytes,
      actualRuntimeMs,
      alignmentConfidence: averageRegistrationConfidence(provenance),
      expectedDetailGainRatio: provenance.effectiveOutputScale,
      falseDetailRisk: provenance.changedPixelRatioAgainstNearest < 0.2 ? 'medium' : 'low',
      humanReviewStatus,
      overlapCoverageRatio: provenance.confidenceMap.completeSampleRatio,
      sourceCount: parsedCommand.parameters.sources.length,
    },
    warningCodes: warnings,
  });
};

export const applySuperResolutionArtifactToSidecar = (
  sidecar: Record<string, unknown>,
  artifact: SuperResolutionArtifactV1,
): SuperResolutionSidecarEnvelopeV1 => {
  const rawEngineValue = sidecar['rawEngine'];
  const rawEngine = isRecord(rawEngineValue) ? rawEngineValue : {};
  const existingArtifacts = readSuperResolutionArtifactsFromRawEngine(rawEngine);
  const parsedArtifact = superResolutionArtifactV1Schema.parse(artifact);
  const artifacts = [
    ...existingArtifacts.filter((existingArtifact) => existingArtifact.artifactId !== parsedArtifact.artifactId),
    parsedArtifact,
  ];

  return superResolutionSidecarEnvelopeV1Schema.parse({
    ...sidecar,
    rawEngine: {
      ...rawEngine,
      superResolutionArtifacts: artifacts,
    },
  });
};

export const readSuperResolutionArtifactsFromSidecar = (sidecar: unknown): SuperResolutionArtifactV1[] => {
  const parsed = superResolutionSidecarEnvelopeV1Schema.parse(sidecar);
  return parsed['rawEngine']?.['superResolutionArtifacts'] ?? [];
};

export const readSuperResolutionArtifactFromSidecar = (
  sidecar: unknown,
  artifactId: string,
): SuperResolutionArtifactV1 | undefined =>
  readSuperResolutionArtifactsFromSidecar(sidecar).find((artifact) => artifact.artifactId === artifactId);

export const classifySuperResolutionArtifactStaleState = (
  artifact: SuperResolutionArtifactV1,
  current: SuperResolutionArtifactCurrentStateV1,
): SuperResolutionArtifactV1['staleState'] => {
  const parsedArtifact = superResolutionArtifactV1Schema.parse(artifact);
  const reasons = new Set<SuperResolutionInvalidationReasonV1>(
    deriveArtifactInvalidationReasons(parsedArtifact, current),
  );

  if (parsedArtifact.requestedOutputScale !== current.requestedOutputScale) reasons.add('scale_changed');
  if (
    parsedArtifact.requestedAlignmentMode !== current.requestedAlignmentMode ||
    parsedArtifact.resolvedAlignmentMode !== current.resolvedAlignmentMode
  ) {
    reasons.add('alignment_settings_changed');
  }
  if (parsedArtifact.detailPolicy !== current.detailPolicy) reasons.add('detail_policy_changed');
  if (parsedArtifact.reconstructionMode !== current.reconstructionMode) reasons.add('reconstruction_mode_changed');
  if (
    parsedArtifact.engine.backendType !== current.engine.backendType ||
    parsedArtifact.engine.engineId !== current.engine.engineId ||
    parsedArtifact.engine.engineVersion !== current.engine.engineVersion
  ) {
    reasons.add('engine_version_changed');
  }
  if (
    parsedArtifact.engine.model?.modelId !== current.engine.model?.modelId ||
    parsedArtifact.engine.model?.modelVersion !== current.engine.model?.modelVersion
  ) {
    reasons.add('model_version_changed');
  }

  return {
    invalidationReasons: sortSuperResolutionInvalidationReasons([...reasons]),
    state: reasons.size > 0 ? 'stale' : 'current',
  };
};

export const markSuperResolutionArtifactStaleState = (
  artifact: SuperResolutionArtifactV1,
  current: SuperResolutionArtifactCurrentStateV1,
  checkedAt?: string,
): SuperResolutionArtifactV1 => {
  const staleState = classifySuperResolutionArtifactStaleState(artifact, current);
  return superResolutionArtifactV1Schema.parse({
    ...artifact,
    staleState: {
      ...staleState,
      ...(checkedAt !== undefined ? { checkedAt } : {}),
    },
  });
};

export const markSuperResolutionArtifactHumanReviewPassed = (
  artifact: SuperResolutionArtifactV1,
  reviewedAt: string,
): SuperResolutionArtifactV1 => {
  const parsedArtifact = superResolutionArtifactV1Schema.parse(artifact);
  if (parsedArtifact.staleState.state !== 'current') {
    throw new Error('SR artifact human review cannot pass a stale artifact.');
  }

  return superResolutionArtifactV1Schema.parse({
    ...parsedArtifact,
    staleState: {
      ...parsedArtifact.staleState,
      checkedAt: reviewedAt,
    },
    validationSummary: {
      ...parsedArtifact.validationSummary,
      humanReviewStatus: 'passed',
    },
    warningCodes: normalizeSuperResolutionWarningCodes(
      parsedArtifact.warningCodes.filter(
        (warningCode: SuperResolutionArtifactV1['warningCodes'][number]) => warningCode !== 'human_review_required',
      ),
    ),
  });
};

const readSuperResolutionArtifactsFromRawEngine = (rawEngine: Record<string, unknown>): SuperResolutionArtifactV1[] => {
  const artifacts = rawEngine['superResolutionArtifacts'];
  if (artifacts === undefined) return [];
  return z.array(superResolutionArtifactV1Schema).parse(artifacts);
};

const averageRegistrationConfidence = (
  provenance: SuperResolutionRuntimeProvenanceV1,
): SuperResolutionArtifactV1['validationSummary']['alignmentConfidence'] => {
  if (provenance.frameRegistrations.length === 0) return undefined;
  const total = provenance.frameRegistrations.reduce((sum, registration) => sum + registration.confidence, 0);
  return roundMetric(total / provenance.frameRegistrations.length);
};

const deriveWarningCodes = (
  provenance: SuperResolutionRuntimeProvenanceV1,
): SuperResolutionArtifactV1['warningCodes'] => {
  const warnings: SuperResolutionArtifactV1['warningCodes'] = [];
  if (provenance.changedPixelRatioAgainstNearest < 0.2) warnings.push('texture_risk');
  if (provenance.detailPolicy === 'aggressive_preview_only') warnings.push('aggressive_preview_only');
  if (provenance.supportMap.downgradeReason !== undefined) warnings.push('effective_scale_downgraded');
  if (provenance.supportMap.weakSupportRatio > 0.25) warnings.push('low_overlap_coverage');
  return warnings;
};

const normalizeSuperResolutionWarningCodes = (
  warningCodes: SuperResolutionArtifactV1['warningCodes'],
): SuperResolutionArtifactV1['warningCodes'] => [...new Set(warningCodes)].sort();

const sortSuperResolutionInvalidationReasons = (
  reasons: SuperResolutionInvalidationReasonV1[],
): SuperResolutionInvalidationReasonV1[] =>
  superResolutionInvalidationReasonV1Schema.options.filter((reason: SuperResolutionInvalidationReasonV1) =>
    reasons.includes(reason),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const roundMetric = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
