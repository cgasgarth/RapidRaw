import cx from 'clsx';
import { useTranslation } from 'react-i18next';

import { TextVariants } from '../../types/typography';
import UiText from '../ui/Text';

import type { NegativeLabQcDecision } from './NegativeLabRollHealthModel';
import type { NegativeLabQcProofReport } from '../../schemas/negativeLabWorkspaceSchemas';
import type {
  NegativeLabQcContactSheetArtifact,
  NegativeLabQcOverlayVisibility,
} from '../../utils/negativeLabQcContactSheetArtifact';

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

  return (
    <div className="space-y-2 rounded-md border border-surface bg-bg-primary p-2" data-testid="negative-lab-qc-proof">
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
        data-contact-sheet-hash={qcProofArtifact.contactSheet.artifact.contentHash}
        data-overlay-count={qcProofArtifact.overlays.length}
        data-overlay-density-warnings={qcOverlayVisibility.densityWarnings ? 'true' : 'false'}
        data-overlay-frame-bounds={qcOverlayVisibility.frameBounds ? 'true' : 'false'}
        data-overlay-rejected-markers={qcOverlayVisibility.rejectedMarkers ? 'true' : 'false'}
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
      </div>
      <div
        className="grid gap-1"
        data-contact-sheet-columns={qcProofReport.contactSheetColumnCount}
        data-export-ready={qcProofReport.exportReady ? 'true' : 'false'}
      >
        {qcProofReport.frames.map((frame) => (
          <div
            className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-sm bg-bg-secondary px-2 py-1 text-xs"
            data-blocked={frame.exportBlockedReason === null ? 'false' : 'true'}
            data-defect-candidate-count={frame.candidates.length}
            data-density-warning-overlay={
              qcOverlayVisibility.densityWarnings && frame.needsReview ? 'visible' : 'hidden'
            }
            data-frame-boundary-overlay={qcOverlayVisibility.frameBounds ? 'visible' : 'hidden'}
            data-rejected-marker-overlay={
              qcOverlayVisibility.rejectedMarkers && qcDecisionByFrameId[frame.frameId] === 'rejected'
                ? 'visible'
                : 'hidden'
            }
            data-testid={`negative-lab-qc-proof-row-${frame.contactSheetSlot - 1}`}
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
            <span className="col-span-3 text-[11px] text-text-tertiary">
              {frame.exportBlockedReason ?? frame.recommendedAction}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
