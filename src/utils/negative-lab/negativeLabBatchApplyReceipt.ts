import type { NegativeLabBatchDryRunSummary } from '../../schemas/negative-lab/negativeLabFrameHealthSchemas';
import type { NegativeLabSavedPositiveHandoff } from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import type { NegativeLabQcContactSheetArtifact } from './negativeLabQcContactSheetArtifact';
import type { NegativeLabRollNormalizationAcceptedPlanIdentity } from './negativeLabRollNormalizationApply';

export interface NegativeLabBatchAppliedPositive {
  frameId: string;
  generatedArtifactId: string;
  generatedContentHash: string;
  outputIntent: NegativeLabQcContactSheetArtifact['positiveVariants'][number]['outputIntent'];
  savedPath: string | null;
  sourcePath: string;
  warningCodes: string[];
}

export interface NegativeLabBatchApplyReceipt extends NegativeLabRollNormalizationAcceptedPlanIdentity {
  acquisitionReviewFrameIds: string[];
  appliedPositiveCount: number;
  appliedPositives: NegativeLabBatchAppliedPositive[];
  contactSheetArtifactId: string;
  editorHandoff: {
    activePositivePath: string | null;
    openInEditor: boolean;
    savedPathCount: number;
  };
  generatedAt: string;
  generatedProofId: string;
  plannedApplyCount: number;
  proofWarningCount: number;
  queuedFrameCount: number;
  reviewFrameCount: number;
  rollWarningCodes: string[];
  savedPaths: string[];
  savedPositiveVariantIds: string[];
  skippedFrameCount: number;
}

interface BuildNegativeLabBatchApplyReceiptParams {
  acceptedPlanIdentity: NegativeLabRollNormalizationAcceptedPlanIdentity;
  activePositivePath?: string | null;
  dryRunSummary: NegativeLabBatchDryRunSummary;
  openInEditor: boolean;
  qcProofArtifact: NegativeLabQcContactSheetArtifact;
  savedPositiveHandoffs?: readonly NegativeLabSavedPositiveHandoff[];
}

const getSavedPositiveBySourcePath = (savedPositiveHandoffs: readonly NegativeLabSavedPositiveHandoff[] = []) =>
  new Map(savedPositiveHandoffs.map((handoff) => [handoff.sourcePath, handoff] as const));

export const buildNegativeLabBatchApplyReceipt = ({
  acceptedPlanIdentity,
  activePositivePath = null,
  dryRunSummary,
  openInEditor,
  qcProofArtifact,
  savedPositiveHandoffs = [],
}: BuildNegativeLabBatchApplyReceiptParams): NegativeLabBatchApplyReceipt => {
  const savedPositiveBySourcePath = getSavedPositiveBySourcePath(savedPositiveHandoffs);
  const applyFrameIds = new Set(dryRunSummary.affectedFrameIds);
  const appliedPositives = qcProofArtifact.positiveVariants
    .filter((positive) => applyFrameIds.has(positive.frameId))
    .map((positive): NegativeLabBatchAppliedPositive => {
      const savedPositive = savedPositiveBySourcePath.get(positive.sourcePath);

      return {
        frameId: positive.frameId,
        generatedArtifactId: positive.outputArtifact.artifactId,
        generatedContentHash: positive.outputArtifact.contentHash,
        outputIntent: positive.outputIntent,
        savedPath: savedPositive?.path ?? null,
        sourcePath: positive.sourcePath,
        warningCodes: positive.warnings.map((warning) => warning.code),
      };
    });

  return {
    ...acceptedPlanIdentity,
    acquisitionReviewFrameIds: [...dryRunSummary.acquisitionReviewFrameIds],
    appliedPositiveCount: appliedPositives.length,
    appliedPositives,
    contactSheetArtifactId: qcProofArtifact.contactSheet.artifact.artifactId,
    editorHandoff: {
      activePositivePath,
      openInEditor,
      savedPathCount: savedPositiveHandoffs.length,
    },
    generatedAt: qcProofArtifact.generatedAt,
    generatedProofId: qcProofArtifact.proofId,
    plannedApplyCount: dryRunSummary.plannedApplyCount,
    proofWarningCount: qcProofArtifact.warnings.length,
    queuedFrameCount: dryRunSummary.frameHealthReport.queuedCount,
    reviewFrameCount: dryRunSummary.reviewFrameIds.length,
    rollWarningCodes: [...dryRunSummary.rollWarningCodes],
    savedPaths: savedPositiveHandoffs.map((handoff) => handoff.path),
    savedPositiveVariantIds: savedPositiveHandoffs.map((handoff) => handoff.positiveVariantId),
    skippedFrameCount: dryRunSummary.skippedFrameIds.length,
  };
};
