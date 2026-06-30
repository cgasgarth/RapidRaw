import cx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { NegativeLabQcProofReport } from '../../../schemas/negativeLabWorkspaceSchemas';
import { TextVariants } from '../../../types/typography';
import type {
  NegativeLabQcContactSheetArtifact,
  NegativeLabQcOverlayVisibility,
} from '../../../utils/negativeLabQcContactSheetArtifact';
import UiText from '../../ui/Text';
import type { NegativeLabQcDecision } from './NegativeLabRollHealthModel';

type NegativeLabQcOverlayKey = keyof NegativeLabQcOverlayVisibility;

const NEGATIVE_LAB_QC_OVERLAY_OPTIONS = [
  {
    key: 'frameBounds',
    labelKey: 'modals.negativeConversion.qcOverlayFrameBounds',
    testId: 'negative-lab-qc-overlay-frame-bounds',
  },
  {
    key: 'densityWarnings',
    labelKey: 'modals.negativeConversion.qcOverlayDensityWarnings',
    testId: 'negative-lab-qc-overlay-density-warnings',
  },
  {
    key: 'rejectedMarkers',
    labelKey: 'modals.negativeConversion.qcOverlayRejectedMarkers',
    testId: 'negative-lab-qc-overlay-rejected-markers',
  },
] satisfies Array<{
  key: NegativeLabQcOverlayKey;
  labelKey: `modals.negativeConversion.${string}`;
  testId: string;
}>;

const OBJECTIVE_QC_FINDING_CODES = new Set([
  'acquisition_review_required',
  'base_fog_only_review',
  'excluded_not_reviewed',
  'preview_required',
]);

const getQcFindingDomain = (findingCodes: readonly string[]): 'objective' | 'creative' =>
  findingCodes.some((code) => OBJECTIVE_QC_FINDING_CODES.has(code)) ? 'objective' : 'creative';

interface NegativeLabQcProofPanelProps {
  onToggleQcOverlay: (key: NegativeLabQcOverlayKey) => void;
  qcDecisionByFrameId: Record<string, NegativeLabQcDecision>;
  qcOverlayVisibility: NegativeLabQcOverlayVisibility;
  qcProofArtifact: NegativeLabQcContactSheetArtifact;
  qcProofReport: NegativeLabQcProofReport;
}

export function NegativeLabQcProofPanel({
  onToggleQcOverlay,
  qcDecisionByFrameId,
  qcOverlayVisibility,
  qcProofArtifact,
  qcProofReport,
}: NegativeLabQcProofPanelProps) {
  const { t } = useTranslation();
  const frameStateByFrameId = new Map(
    qcProofArtifact.frameStates.map((frameState) => [frameState.frameId, frameState]),
  );
  const positiveVariantByFrameId = new Map(
    qcProofArtifact.positiveVariants.map((variant) => [variant.frameId, variant]),
  );
  const rollMetricByFrameId = new Map(
    qcProofArtifact.rollConsistency.frameMetrics.map((metric) => [metric.frameId, metric]),
  );

  return (
    <div
      className="space-y-2 rounded-md border border-surface bg-bg-primary p-2"
      data-contact-sheet-artifact-id={qcProofArtifact.contactSheet.artifact.artifactId}
      data-contact-sheet-height={qcProofArtifact.contactSheet.artifact.dimensions.height}
      data-contact-sheet-width={qcProofArtifact.contactSheet.artifact.dimensions.width}
      data-frame-state-count={qcProofArtifact.frameStates.length}
      data-output-policy="no-overwrite-temp-cache"
      data-proof-id={qcProofArtifact.proofId}
      data-testid="negative-lab-qc-proof"
    >
      <div className="flex items-center justify-between gap-2">
        <UiText variant={TextVariants.small} className="font-medium text-text-primary">
          {t('modals.negativeConversion.qcProofReport')}
        </UiText>
        <div className="flex gap-1 text-[11px] text-text-tertiary">
          <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-qc-proof-frame-count">
            {t('modals.negativeConversion.frameHealthFrameCount', { frameCount: qcProofReport.totalFrameCount })}
          </span>
          <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-qc-proof-review-count">
            {t('modals.negativeConversion.dustReviewCount', { reviewCount: qcProofReport.reviewFrameCount })}
          </span>
        </div>
      </div>
      <UiText variant={TextVariants.small} className="text-text-tertiary">
        {t('modals.negativeConversion.qcProofHint')}
      </UiText>
      <div
        className="grid grid-cols-3 gap-1 rounded-sm bg-bg-secondary p-2 text-[11px]"
        data-density-warnings={qcOverlayVisibility.densityWarnings ? 'true' : 'false'}
        data-frame-bounds={qcOverlayVisibility.frameBounds ? 'true' : 'false'}
        data-rejected-markers={qcOverlayVisibility.rejectedMarkers ? 'true' : 'false'}
        data-testid="negative-lab-qc-overlay-controls"
      >
        {NEGATIVE_LAB_QC_OVERLAY_OPTIONS.map((option) => (
          <button
            aria-pressed={qcOverlayVisibility[option.key]}
            className={cx(
              'rounded px-1.5 py-1 transition-colors',
              qcOverlayVisibility[option.key]
                ? 'bg-accent/15 text-text-primary'
                : 'bg-bg-primary text-text-tertiary hover:bg-surface',
            )}
            data-overlay-enabled={qcOverlayVisibility[option.key] ? 'true' : 'false'}
            data-testid={option.testId}
            key={option.key}
            onClick={() => {
              onToggleQcOverlay(option.key);
            }}
            type="button"
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>
      <div
        className="grid grid-cols-2 gap-1 rounded-sm bg-bg-secondary p-2 text-[11px] text-text-tertiary"
        data-contact-sheet-artifact-id={qcProofArtifact.contactSheet.artifact.artifactId}
        data-contact-sheet-hash={qcProofArtifact.contactSheet.artifact.contentHash}
        data-contact-sheet-height={qcProofArtifact.contactSheet.artifact.dimensions.height}
        data-contact-sheet-width={qcProofArtifact.contactSheet.artifact.dimensions.width}
        data-frame-ids={qcProofArtifact.frameIds.join('|')}
        data-overlay-count={qcProofArtifact.overlays.length}
        data-overlay-density-warnings={qcOverlayVisibility.densityWarnings ? 'true' : 'false'}
        data-overlay-frame-bounds={qcOverlayVisibility.frameBounds ? 'true' : 'false'}
        data-overlay-rejected-markers={qcOverlayVisibility.rejectedMarkers ? 'true' : 'false'}
        data-positive-variant-count={qcProofArtifact.positiveVariants.length}
        data-roll-anchor-frame-ids={qcProofArtifact.rollConsistency.anchorFrameIds.join('|')}
        data-roll-density-delta-tolerance={qcProofArtifact.rollConsistency.densityDeltaTolerance}
        data-roll-metric-version={qcProofArtifact.rollConsistency.metricVersion}
        data-testid="negative-lab-qc-proof-artifact"
      >
        <span>
          {t('modals.negativeConversion.qcProofArtifactHash', {
            hash: qcProofArtifact.contactSheet.artifact.contentHash,
          })}
        </span>
        <span>
          {t('modals.negativeConversion.qcProofArtifactGrid', {
            columns: qcProofArtifact.contactSheet.columns,
            rows: qcProofArtifact.contactSheet.rows,
          })}
        </span>
        <span>
          {t('modals.negativeConversion.qcProofArtifactWarnings', {
            warningCount: qcProofArtifact.warnings.length,
          })}
        </span>
        <span>
          {t('modals.negativeConversion.qcProofArtifactVariants', {
            variantCount: qcProofArtifact.positiveVariants.length,
          })}
        </span>
        <span>
          {t('modals.negativeConversion.qcProofArtifactDimensions', {
            height: qcProofArtifact.contactSheet.artifact.dimensions.height,
            width: qcProofArtifact.contactSheet.artifact.dimensions.width,
          })}
        </span>
        <span>
          {t('modals.negativeConversion.qcProofArtifactOverlays', {
            overlayCount: qcProofArtifact.overlays.length,
          })}
        </span>
      </div>
      <div
        className="grid gap-1"
        data-contact-sheet-columns={qcProofReport.contactSheetColumnCount}
        data-export-ready={qcProofReport.exportReady ? 'true' : 'false'}
      >
        {qcProofReport.frames.map((frame) => {
          const frameState = frameStateByFrameId.get(frame.frameId);
          const positiveVariant = positiveVariantByFrameId.get(frame.frameId);
          const rollMetric = rollMetricByFrameId.get(frame.frameId);
          const warningDomain = getQcFindingDomain(frame.findingCodes);
          const qcDecision = frameState?.qcDecision ?? qcDecisionByFrameId[frame.frameId] ?? 'pending';

          return (
            <div
              className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-sm bg-bg-secondary px-2 py-1 text-xs"
              data-blocked={frame.exportBlockedReason === null ? 'false' : 'true'}
              data-defect-candidate-count={frame.candidates.length}
              data-density-delta={rollMetric?.densityDelta ?? ''}
              data-density-warning-overlay={
                qcOverlayVisibility.densityWarnings && frame.needsReview ? 'visible' : 'hidden'
              }
              data-frame-boundary-overlay={qcOverlayVisibility.frameBounds ? 'visible' : 'hidden'}
              data-frame-id={frame.frameId}
              data-included={String(frame.included)}
              data-output-artifact-id={positiveVariant?.outputArtifact.artifactId ?? ''}
              data-output-intent={positiveVariant?.outputIntent ?? ''}
              data-proof-state={frameState?.proofState ?? (frame.included ? 'included' : 'excluded')}
              data-qc-decision={qcDecision}
              data-rejected-marker-overlay={
                qcOverlayVisibility.rejectedMarkers && qcDecision === 'rejected' ? 'visible' : 'hidden'
              }
              data-roll-within-tolerance={String(rollMetric?.withinTolerance ?? '')}
              data-source-content-hash={positiveVariant?.sourceContentHash ?? ''}
              data-source-path={positiveVariant?.sourcePath ?? ''}
              data-testid={`negative-lab-qc-proof-row-${frame.contactSheetSlot - 1}`}
              data-variant-warning-count={positiveVariant?.warnings.length ?? 0}
              data-warning-domain={warningDomain}
              key={frame.frameId}
            >
              <span className="rounded bg-bg-primary px-1.5 py-0.5 text-[11px] text-text-tertiary">
                {frame.contactSheetSlot}
              </span>
              <span className="min-w-0 truncate text-text-secondary">{frame.scanLabel}</span>
              <span
                className={cx(
                  'rounded px-1.5 py-0.5',
                  frame.needsReview ? 'bg-surface text-text-secondary' : 'bg-accent/15 text-text-primary',
                )}
              >
                {frame.needsReview
                  ? t('modals.negativeConversion.dustSeverity.review')
                  : t('modals.negativeConversion.previewReady')}
              </span>
              <span
                className="col-span-3 text-[11px] text-text-tertiary"
                data-testid={`negative-lab-qc-proof-warning-${frame.contactSheetSlot - 1}`}
              >
                {frame.exportBlockedReason ?? frame.recommendedAction}
              </span>
              {positiveVariant !== undefined && (
                <span
                  className="col-span-3 truncate font-mono text-[11px] text-text-tertiary"
                  data-testid={`negative-lab-qc-proof-positive-variant-${frame.contactSheetSlot - 1}`}
                  title={`${positiveVariant.sourcePath} ${positiveVariant.outputArtifact.artifactId}`}
                >
                  {t('modals.negativeConversion.qcProofPositiveVariant', {
                    artifactId: positiveVariant.outputArtifact.artifactId,
                    intent: positiveVariant.outputIntent,
                  })}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
