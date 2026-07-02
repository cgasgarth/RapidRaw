import type { NegativeLabConversionPlanResult } from '../../schemas/negative-lab/negativeLabAppServerSchemas';
import type { NegativeLabBatchDryRunSummary } from '../../schemas/negative-lab/negativeLabFrameHealthSchemas';
import {
  NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION,
  type NegativeLabDustScratchReviewReport,
  type NegativeLabWorkspaceProof,
} from '../../schemas/negative-lab/negativeLabWorkspaceSchemas';

import type { NegativeLabQcContactSheetArtifact } from './negativeLabQcContactSheetArtifact';

export interface NegativeLabExportReadinessInput {
  baseReady: boolean;
  batchPlanAccepted: boolean;
  isLoading: boolean;
  isSaving: boolean;
  pathCount: number;
  previewReady: boolean;
  requiresAcceptedBatchPlan: boolean;
}

export type NegativeLabSaveBlockedReasonKey =
  | 'modals.negativeConversion.agentDryRunBlocked'
  | 'modals.negativeConversion.basePending'
  | 'modals.negativeConversion.previewPending'
  | 'modals.negativeConversion.workflowExportBlocked';

export interface NegativeLabExportReadiness {
  canSave: boolean;
  saveBlockedReasonKey: NegativeLabSaveBlockedReasonKey | null;
}

export type NegativeLabPositiveVariant = NegativeLabQcContactSheetArtifact['positiveVariants'][number];
type NegativeLabPositiveOutputFormat = NegativeLabConversionPlanResult['outputFormat'];

interface NegativeLabPositiveOutputConversionPlan {
  outputFormat: string;
  params: NegativeLabConversionPlanResult['params'];
  profileProvenanceHash: NegativeLabConversionPlanResult['profileProvenanceHash'];
  suffix: NegativeLabConversionPlanResult['suffix'];
}

export interface NegativeLabAcceptedBatchPlanIdentity {
  acceptedDryRunPlanHash: string;
  acceptedDryRunPlanId: string;
}

export interface NegativeLabPositiveOutputReceipt {
  acceptedDryRunPlanHash: string;
  acceptedDryRunPlanId: string;
  conversionBundleContentHash: string;
  conversionBundlePath: string;
  frameId: string;
  outputArtifact: {
    artifactId: string;
    contentHash: string;
    dimensions: { height: number; width: number };
    kind: 'export';
    storage: 'export_path';
  };
  outputFileName: string;
  outputFormat: NegativeLabConversionPlanResult['outputFormat'];
  outputPath: string;
  positiveVariantId: string;
  profileProvenanceHash: string;
  provenanceEntryIds: string[];
  sidecarContentHash: string;
  sidecarPath: string;
  sourceContentHash: string;
  sourcePath: string;
}

export interface NegativeLabPositiveOutputRejectedFrame {
  frameId: string;
  reason: 'missing_positive_variant' | 'source_overwrite_guard' | 'unsupported_output_format';
  sourcePath: string;
}

export interface NegativeLabPositiveOutputBuildResult {
  exportedPositives: NegativeLabPositiveOutputReceipt[];
  rejectedFrames: NegativeLabPositiveOutputRejectedFrame[];
}

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const stableSha256LikeHash = (namespace: string, payload: unknown): string => {
  const serialized = JSON.stringify({ namespace, payload });
  const digest = Array.from({ length: 8 }, (_, index) => fnv1a32(`${index}:${serialized}`)).join('');
  return `sha256:${digest}`;
};

const splitOutputPath = (sourcePath: string): { baseName: string; directory: string; extension: string } => {
  const separatorIndex = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\'));
  const directory = separatorIndex >= 0 ? sourcePath.slice(0, separatorIndex) : '';
  const fileName = separatorIndex >= 0 ? sourcePath.slice(separatorIndex + 1) : sourcePath;
  const extensionIndex = fileName.lastIndexOf('.');
  if (extensionIndex <= 0) return { baseName: fileName, directory, extension: '' };
  return {
    baseName: fileName.slice(0, extensionIndex),
    directory,
    extension: fileName.slice(extensionIndex),
  };
};

const joinOutputPath = (directory: string, fileName: string): string =>
  directory.length === 0 ? fileName : `${directory}/${fileName}`;

const isNegativeLabPositiveOutputFormat = (outputFormat: string): outputFormat is NegativeLabPositiveOutputFormat =>
  outputFormat === 'jpeg_proof' || outputFormat === 'tiff16';

const outputExtensionForFormat = (outputFormat: string): string | null => {
  if (outputFormat === 'jpeg_proof') return '.jpg';
  if (outputFormat === 'tiff16') return '.tif';
  return null;
};

const buildPositiveOutputFileName = ({
  outputFormat,
  sourcePath,
  suffix,
}: {
  outputFormat: string;
  sourcePath: string;
  suffix: string;
}): string | null => {
  const extension = outputExtensionForFormat(outputFormat);
  if (extension === null) return null;
  const { baseName } = splitOutputPath(sourcePath);
  return `${baseName}-${suffix}${extension}`;
};

const basenameOf = (path: string): string => {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
};

export const buildNegativeLabPositiveOutputReceipts = ({
  acceptedPlanIdentity,
  conversionPlan,
  dryRunSummary,
  positiveVariants,
}: {
  acceptedPlanIdentity: NegativeLabAcceptedBatchPlanIdentity;
  conversionPlan: NegativeLabPositiveOutputConversionPlan;
  dryRunSummary: NegativeLabBatchDryRunSummary;
  positiveVariants: readonly NegativeLabPositiveVariant[];
}): NegativeLabPositiveOutputBuildResult => {
  const positiveByFrameId = new Map(positiveVariants.map((positive) => [positive.frameId, positive] as const));
  const rejectedFrames: NegativeLabPositiveOutputRejectedFrame[] = [];
  const exportedPositives: NegativeLabPositiveOutputReceipt[] = [];

  for (const frame of dryRunSummary.frameHealthReport.frames) {
    if (!dryRunSummary.affectedFrameIds.includes(frame.frameId)) continue;

    const positive = positiveByFrameId.get(frame.frameId);
    if (positive === undefined) {
      rejectedFrames.push({ frameId: frame.frameId, reason: 'missing_positive_variant', sourcePath: frame.sourcePath });
      continue;
    }

    const outputFileName = buildPositiveOutputFileName({
      outputFormat: conversionPlan.outputFormat,
      sourcePath: frame.sourcePath,
      suffix: conversionPlan.suffix,
    });
    if (outputFileName === null) {
      rejectedFrames.push({
        frameId: frame.frameId,
        reason: 'unsupported_output_format',
        sourcePath: frame.sourcePath,
      });
      continue;
    }
    if (!isNegativeLabPositiveOutputFormat(conversionPlan.outputFormat)) {
      rejectedFrames.push({
        frameId: frame.frameId,
        reason: 'unsupported_output_format',
        sourcePath: frame.sourcePath,
      });
      continue;
    }

    const outputPath = joinOutputPath(splitOutputPath(frame.sourcePath).directory, outputFileName);
    if (outputPath === frame.sourcePath || basenameOf(outputPath) === basenameOf(frame.sourcePath)) {
      rejectedFrames.push({ frameId: frame.frameId, reason: 'source_overwrite_guard', sourcePath: frame.sourcePath });
      continue;
    }

    const positiveVariantId = `positive_variant_${frame.frameId}`;
    const sidecarPath = `${outputPath}.rawengine-negative-lab.json`;
    const conversionBundlePath = `${outputPath}.negative-lab-bundle.json`;
    const provenanceEntryIds = [
      `prov_${acceptedPlanIdentity.acceptedDryRunPlanId}_${frame.frameId}`,
      `prov_${positive.operationId}`,
    ];
    const outputPayload = {
      acceptedDryRunPlanHash: acceptedPlanIdentity.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: acceptedPlanIdentity.acceptedDryRunPlanId,
      frameId: frame.frameId,
      outputFormat: conversionPlan.outputFormat,
      positiveVariantId,
      profileProvenanceHash: conversionPlan.profileProvenanceHash,
      sourceContentHash: positive.sourceContentHash,
      sourcePath: frame.sourcePath,
    };
    const outputContentHash = stableSha256LikeHash('negative-lab-positive-output', outputPayload);
    const sidecarContentHash = stableSha256LikeHash('negative-lab-positive-sidecar', {
      ...outputPayload,
      outputContentHash,
      outputPath,
      provenanceEntryIds,
    });
    const conversionBundleContentHash = stableSha256LikeHash('negative-lab-conversion-bundle', {
      ...outputPayload,
      conversionParams: conversionPlan.params,
      outputContentHash,
      outputPath,
      sidecarContentHash,
    });

    exportedPositives.push({
      ...acceptedPlanIdentity,
      conversionBundleContentHash,
      conversionBundlePath,
      frameId: frame.frameId,
      outputArtifact: {
        artifactId: `artifact_${positiveVariantId}_export`,
        contentHash: outputContentHash,
        dimensions: positive.outputArtifact.dimensions,
        kind: 'export',
        storage: 'export_path',
      },
      outputFileName,
      outputFormat: conversionPlan.outputFormat,
      outputPath,
      positiveVariantId,
      profileProvenanceHash: conversionPlan.profileProvenanceHash,
      provenanceEntryIds,
      sidecarContentHash,
      sidecarPath,
      sourceContentHash: positive.sourceContentHash,
      sourcePath: frame.sourcePath,
    });
  }

  return { exportedPositives, rejectedFrames };
};

export const buildNegativeLabCanSave = ({
  baseReady,
  batchPlanAccepted,
  isLoading,
  isSaving,
  pathCount,
  previewReady,
  requiresAcceptedBatchPlan,
}: NegativeLabExportReadinessInput): boolean =>
  !isSaving &&
  !isLoading &&
  previewReady &&
  baseReady &&
  pathCount > 0 &&
  (!requiresAcceptedBatchPlan || batchPlanAccepted);

export const buildNegativeLabSaveBlockedReason = (
  input: NegativeLabExportReadinessInput & { canSave: boolean },
): NegativeLabSaveBlockedReasonKey | null => {
  if (input.canSave || input.isSaving) return null;
  if (input.isLoading || !input.previewReady) return 'modals.negativeConversion.previewPending';
  if (!input.baseReady) return 'modals.negativeConversion.basePending';
  if (input.pathCount === 0) return 'modals.negativeConversion.workflowExportBlocked';
  if (input.requiresAcceptedBatchPlan && !input.batchPlanAccepted)
    return 'modals.negativeConversion.agentDryRunBlocked';
  return 'modals.negativeConversion.workflowExportBlocked';
};

export const buildNegativeLabExportReadiness = ({
  baseReady,
  batchPlanAccepted,
  isLoading,
  isSaving,
  pathCount,
  previewReady,
  requiresAcceptedBatchPlan,
}: NegativeLabExportReadinessInput): NegativeLabExportReadiness => {
  const input = {
    baseReady,
    batchPlanAccepted,
    isLoading,
    isSaving,
    pathCount,
    previewReady,
    requiresAcceptedBatchPlan,
  };
  const canSave = buildNegativeLabCanSave(input);

  return {
    canSave,
    saveBlockedReasonKey: buildNegativeLabSaveBlockedReason({ ...input, canSave }),
  };
};

export const selectNegativeLabActivePositiveVariant = (
  positiveVariants: readonly NegativeLabPositiveVariant[],
  activeFrameId: string | null,
): NegativeLabPositiveVariant | null =>
  positiveVariants.find((variant) => variant.frameId === activeFrameId) ?? positiveVariants[0] ?? null;

export const buildNegativeLabWorkspaceProof = ({
  canSave,
  previewReady,
  queuedCount,
  reviewReport,
  targetCount,
}: {
  canSave: boolean;
  previewReady: boolean;
  queuedCount: number;
  reviewReport: NegativeLabDustScratchReviewReport;
  targetCount: number;
}): NegativeLabWorkspaceProof => ({
  activeStage: canSave ? 'export' : previewReady ? 'inspection' : 'colorInversion',
  exportReady: canSave,
  previewReady,
  queuedCount,
  reviewReport,
  schemaVersion: NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION,
  targetCount,
});

export const buildNegativeLabPositiveHandoffReadiness = ({
  activePositiveVariant,
  canSave,
  qcExportReady,
}: {
  activePositiveVariant: NegativeLabPositiveVariant | null;
  canSave: boolean;
  qcExportReady: boolean;
}): boolean =>
  canSave && qcExportReady && activePositiveVariant !== null && activePositiveVariant.warnings.length === 0;
