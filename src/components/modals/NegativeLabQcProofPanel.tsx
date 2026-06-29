import cx from 'clsx';
import { useTranslation } from 'react-i18next';

import { TextVariants } from '../../types/typography';
import UiText from '../ui/Text';

import type { NegativeLabQcDecision } from './NegativeLabRollHealthModel';
import type {
  NegativeLabDensityPrintAlgorithm,
  NegativeLabDensityPrintOutputTag,
} from '../../schemas/negativeLabPresetCatalogSchemas';
import type { NegativeLabQcProofReport } from '../../schemas/negativeLabWorkspaceSchemas';
import type {
  NegativeLabQcContactSheetArtifact,
  NegativeLabQcOverlayVisibility,
} from '../../utils/negativeLabQcContactSheetArtifact';

type NegativeLabQcOverlayKey = keyof NegativeLabQcOverlayVisibility;

interface NegativeLabQcRuntimeReadouts {
  algorithm: {
    algorithmId: NegativeLabDensityPrintAlgorithm;
    algorithmVersion: 1 | 2;
    outputTag: NegativeLabDensityPrintOutputTag;
  };
  castConfidencePercent: number | null;
  crosstalk: {
    applied: boolean;
    profileId: string;
    provenance: string;
    provenanceHash: string;
    strength: number;
  } | null;
  previewExportArtifactParity: {
    dimensionsMatch: boolean;
    exportArtifactCount: number;
    previewArtifactCount: number;
  };
  scanMetricsSummary: {
    analysisCropLabel: string;
    clippingCount: number;
    densityRangeUnclamped: number;
    frameCount: number;
    sampleCount: number;
    texturalDensityRangeP10P90: number;
  };
}

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
  runtimeReadouts: NegativeLabQcRuntimeReadouts;
}

export function NegativeLabQcProofPanel({
  onToggleQcOverlay,
  qcDecisionByFrameId,
  qcOverlayVisibility,
  qcProofArtifact,
  qcProofReport,
  runtimeReadouts,
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
        className="grid grid-cols-2 gap-1 rounded-sm bg-bg-secondary p-2 text-[11px] text-text-tertiary"
        data-algorithm-id={runtimeReadouts.algorithm.algorithmId}
        data-algorithm-version={runtimeReadouts.algorithm.algorithmVersion}
        data-analysis-crop={runtimeReadouts.scanMetricsSummary.analysisCropLabel}
        data-cast-confidence={runtimeReadouts.castConfidencePercent ?? ''}
        data-clipping-count={runtimeReadouts.scanMetricsSummary.clippingCount}
        data-density-range={runtimeReadouts.scanMetricsSummary.densityRangeUnclamped.toFixed(3)}
        data-dimensions-match={runtimeReadouts.previewExportArtifactParity.dimensionsMatch ? 'true' : 'false'}
        data-export-artifact-count={runtimeReadouts.previewExportArtifactParity.exportArtifactCount}
        data-frame-count={runtimeReadouts.scanMetricsSummary.frameCount}
        data-output-tag={runtimeReadouts.algorithm.outputTag}
        data-preview-artifact-count={runtimeReadouts.previewExportArtifactParity.previewArtifactCount}
        data-sample-count={runtimeReadouts.scanMetricsSummary.sampleCount}
        data-testid="negative-lab-v2-qc-runtime-readouts"
        data-textural-density-range={runtimeReadouts.scanMetricsSummary.texturalDensityRangeP10P90.toFixed(3)}
      >
        <span>{t('modals.negativeConversion.qcRuntimeAlgorithm')}</span>
        <span className="truncate text-right text-text-secondary" data-testid="negative-lab-v2-qc-algorithm">
          {t(`modals.negativeConversion.printCurveAlgorithms.${runtimeReadouts.algorithm.algorithmId}`)}
        </span>
        <span>{t('modals.negativeConversion.qcRuntimeScanMetrics')}</span>
        <span className="text-right tabular-nums text-text-secondary" data-testid="negative-lab-v2-qc-scan-metrics">
          {t('modals.negativeConversion.qcRuntimeScanMetricsValue', {
            frameCount: runtimeReadouts.scanMetricsSummary.frameCount,
            sampleCount: runtimeReadouts.scanMetricsSummary.sampleCount,
          })}
        </span>
        <span>{t('modals.negativeConversion.qcRuntimeDensityRange')}</span>
        <span className="text-right tabular-nums text-text-secondary" data-testid="negative-lab-v2-qc-density-range">
          {t('modals.negativeConversion.qcRuntimeDensityRangeValue', {
            range: runtimeReadouts.scanMetricsSummary.densityRangeUnclamped.toFixed(3),
            texturalRange: runtimeReadouts.scanMetricsSummary.texturalDensityRangeP10P90.toFixed(3),
          })}
        </span>
        <span>{t('modals.negativeConversion.qcRuntimeClippingCrop')}</span>
        <span className="text-right tabular-nums text-text-secondary" data-testid="negative-lab-v2-qc-clipping-crop">
          {t('modals.negativeConversion.qcRuntimeClippingCropValue', {
            clippingCount: runtimeReadouts.scanMetricsSummary.clippingCount,
            crop: runtimeReadouts.scanMetricsSummary.analysisCropLabel,
          })}
        </span>
        <span>{t('modals.negativeConversion.qcRuntimeCastConfidence')}</span>
        <span className="text-right tabular-nums text-text-secondary" data-testid="negative-lab-v2-qc-cast-confidence">
          {runtimeReadouts.castConfidencePercent === null
            ? t('modals.negativeConversion.qcRuntimeCastConfidencePending')
            : t('modals.negativeConversion.qcRuntimeCastConfidenceValue', {
                confidence: runtimeReadouts.castConfidencePercent,
              })}
        </span>
        <span>{t('modals.negativeConversion.qcRuntimePreviewExportParity')}</span>
        <span className="text-right text-text-secondary" data-testid="negative-lab-v2-qc-preview-export-parity">
          {runtimeReadouts.previewExportArtifactParity.dimensionsMatch
            ? t('modals.negativeConversion.qcRuntimePreviewExportParityMatch', {
                exportCount: runtimeReadouts.previewExportArtifactParity.exportArtifactCount,
                previewCount: runtimeReadouts.previewExportArtifactParity.previewArtifactCount,
              })
            : t('modals.negativeConversion.qcRuntimePreviewExportParityReview', {
                exportCount: runtimeReadouts.previewExportArtifactParity.exportArtifactCount,
                previewCount: runtimeReadouts.previewExportArtifactParity.previewArtifactCount,
              })}
        </span>
        {runtimeReadouts.crosstalk !== null && (
          <>
            <span>{t('modals.negativeConversion.qcRuntimeCrosstalk')}</span>
            <span
              className="truncate text-right text-text-secondary"
              data-crosstalk-applied={runtimeReadouts.crosstalk.applied ? 'true' : 'false'}
              data-crosstalk-profile-id={runtimeReadouts.crosstalk.profileId}
              data-crosstalk-provenance={runtimeReadouts.crosstalk.provenance}
              data-crosstalk-provenance-hash={runtimeReadouts.crosstalk.provenanceHash}
              data-crosstalk-strength={runtimeReadouts.crosstalk.strength.toFixed(2)}
              data-testid="negative-lab-v2-qc-crosstalk"
              title={runtimeReadouts.crosstalk.profileId}
            >
              {t('modals.negativeConversion.qcRuntimeCrosstalkValue', {
                provenance: runtimeReadouts.crosstalk.provenance,
                strength: runtimeReadouts.crosstalk.strength.toFixed(2),
              })}
            </span>
          </>
        )}
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
