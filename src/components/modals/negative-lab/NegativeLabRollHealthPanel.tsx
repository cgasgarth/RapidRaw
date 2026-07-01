import cx from 'clsx';
import type { TFunction } from 'i18next';
import { Copy, Images, RotateCcw, WandSparkles } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  NegativeLabBatchDryRunSummary,
  NegativeLabFrameCropStatus,
  NegativeLabFrameHealthEntry,
  NegativeLabFrameHealthReport,
} from '../../../schemas/negative-lab/negativeLabFrameHealthSchemas';
import type { NegativeLabFrameRgbBalanceOffset } from '../../../schemas/negative-lab/negativeLabFrameRgbBalanceOverrideSchemas';
import type { NegativeLabPresetParams } from '../../../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import type { NegativeLabRollNormalizationPlan } from '../../../schemas/negative-lab/negativeLabRollNormalizationSchemas';
import { TextVariants } from '../../../types/typography';
import type { NegativeLabBatchApplyReceipt } from '../../../utils/negative-lab/negativeLabBatchApplyReceipt';
import { snapNegativeLabFrameExposureOffset } from '../../../utils/negative-lab/negativeLabFrameExposureOverrides';
import {
  negativeLabFrameRgbBalanceOffsetIsZero,
  snapNegativeLabFrameRgbBalanceOffsets,
} from '../../../utils/negative-lab/negativeLabFrameRgbBalanceOverrides';
import type { NegativeLabAcceptedApplyPlanStaleReason } from '../../../utils/negative-lab/negativeLabPlanIdentity';
import type {
  NegativeLabRollNormalizationApplyReceipt,
  NegativeLabRollNormalizationRestoreReceipt,
} from '../../../utils/negative-lab/negativeLabRollNormalizationApply';
import UiText from '../../ui/primitives/Text';
import {
  ACQUISITION_SOURCE_FAMILY_LABEL_KEYS,
  ACQUISITION_WARNING_LABEL_KEYS,
  BATCH_DISPOSITION_LABEL_KEYS,
  BATCH_DISPOSITION_REASON_LABEL_KEYS,
  getNegativeLabFrameWarningCount,
  isNegativeLabFrameHealthFilter,
  isNegativeLabFrameHealthSort,
  NEGATIVE_LAB_FRAME_HEALTH_FILTERS,
  NEGATIVE_LAB_FRAME_HEALTH_SORTS,
  type NegativeLabFrameHealthFilter,
  type NegativeLabFrameHealthSort,
  type NegativeLabQcDecision,
  QC_DECISION_LABEL_KEYS,
} from './NegativeLabRollHealthModel';

interface NegativeLabRollHealthPanelProps {
  approvedQcFrameIds: readonly string[];
  batchApplyFrameCount: number;
  batchPlanStaleReasons: readonly NegativeLabAcceptedApplyPlanStaleReason[];
  batchDryRunSummary: NegativeLabBatchDryRunSummary;
  batchReviewFrameCount: number;
  batchSkippedFrameCount: number;
  frameExposureOffsetByFrameId: Record<string, number>;
  frameHealthFilter: NegativeLabFrameHealthFilter;
  frameHealthReport: NegativeLabFrameHealthReport;
  frameHealthSort: NegativeLabFrameHealthSort;
  frameRgbBalanceOffsetByFrameId: Record<string, NegativeLabFrameRgbBalanceOffset>;
  handleAcceptBatchPlan: () => void;
  handleApplyBatchPlan: () => void;
  handleApplyRollNormalizationPlan: () => void;
  handleCopyBatchPlan: () => void | Promise<void>;
  handleRestoreRollNormalizationPlan: () => void;
  handleSetActiveFrameCropStatus: (status: NegativeLabFrameCropStatus) => void;
  handleSetQcDecision: (frameId: string, decision: NegativeLabQcDecision) => void;
  handleSetVisibleQcDecision: (decision: NegativeLabQcDecision) => void;
  isBatchPlanAccepted: boolean;
  batchApplyReceipt: NegativeLabBatchApplyReceipt | null;
  isBatchPlanCopied: boolean;
  isRollNormalizationPlanAccepted: boolean;
  isSaving: boolean;
  params: NegativeLabPresetParams;
  qcDecisionByFrameId: Record<string, NegativeLabQcDecision>;
  rejectedQcFrameIds: readonly string[];
  rollNormalizationApplyReceipt: NegativeLabRollNormalizationApplyReceipt | null;
  rollNormalizationPlan: NegativeLabRollNormalizationPlan;
  rollNormalizationRestoreReceipt: NegativeLabRollNormalizationRestoreReceipt | null;
  rollWarningCount: number;
  setFrameHealthFilter: Dispatch<SetStateAction<NegativeLabFrameHealthFilter>>;
  setFrameHealthSort: Dispatch<SetStateAction<NegativeLabFrameHealthSort>>;
  t: TFunction;
  visibleFrameHealthRows: readonly NegativeLabFrameHealthEntry[];
}

const formatSignedRecipeValue = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

export function NegativeLabRollHealthPanel({
  approvedQcFrameIds,
  batchApplyFrameCount,
  batchPlanStaleReasons,
  batchDryRunSummary,
  batchReviewFrameCount,
  batchSkippedFrameCount,
  frameExposureOffsetByFrameId,
  frameHealthFilter,
  frameHealthReport,
  frameHealthSort,
  frameRgbBalanceOffsetByFrameId,
  handleAcceptBatchPlan,
  handleApplyBatchPlan,
  handleApplyRollNormalizationPlan,
  handleCopyBatchPlan,
  handleRestoreRollNormalizationPlan,
  handleSetActiveFrameCropStatus,
  handleSetQcDecision,
  handleSetVisibleQcDecision,
  isBatchPlanAccepted,
  batchApplyReceipt,
  isBatchPlanCopied,
  isRollNormalizationPlanAccepted,
  isSaving,
  params,
  qcDecisionByFrameId,
  rejectedQcFrameIds,
  rollNormalizationApplyReceipt,
  rollNormalizationPlan,
  rollNormalizationRestoreReceipt,
  rollWarningCount,
  setFrameHealthFilter,
  setFrameHealthSort,
  t,
  visibleFrameHealthRows,
}: NegativeLabRollHealthPanelProps) {
  if (frameHealthReport.frames.length === 0) return null;

  return (
    <div
      aria-label={t('modals.negativeConversion.frameHealth')}
      className="space-y-1"
      data-testid="negative-lab-frame-health-grid"
      role="region"
    >
      <div className="flex items-center justify-between gap-2">
        <UiText variant={TextVariants.small} className="text-text-tertiary">
          {t('modals.negativeConversion.frameHealth')}
        </UiText>
        <div className="flex items-center gap-1 text-[11px] text-text-tertiary">
          <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-frame-count">
            {t('modals.negativeConversion.frameHealthFrameCount', { frameCount: frameHealthReport.frames.length })}
          </span>
          <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-roll-warning-count">
            {t('modals.negativeConversion.frameHealthWarningCount', { warningCount: rollWarningCount })}
          </span>
        </div>
      </div>
      <div
        aria-label={t('modals.negativeConversion.batchReadiness')}
        className="grid grid-cols-3 gap-1 text-[11px] text-text-tertiary"
        role="status"
      >
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-planned-apply-count">
          {t('modals.negativeConversion.batchPlanApplyCount', { applyCount: batchApplyFrameCount })}
        </span>
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-skipped-frame-count">
          {t('modals.negativeConversion.batchPlanSkippedCount', { skippedCount: batchSkippedFrameCount })}
        </span>
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-review-frame-count">
          {t('modals.negativeConversion.batchPlanReviewCount', { reviewCount: batchReviewFrameCount })}
        </span>
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-qc-approved-count">
          {t('modals.negativeConversion.qcApprovedCount', { approvedCount: approvedQcFrameIds.length })}
        </span>
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-qc-rejected-count">
          {t('modals.negativeConversion.qcRejectedCount', { rejectedCount: rejectedQcFrameIds.length })}
        </span>
        <span className="rounded bg-bg-secondary px-1.5 py-0.5" data-testid="negative-lab-batch-workload-summary">
          {t('modals.negativeConversion.batchWorkloadSummary', {
            applyCount: batchApplyFrameCount,
            reviewCount: batchReviewFrameCount,
            skippedCount: batchSkippedFrameCount,
          })}
        </span>
        <span
          className="col-span-3 rounded bg-bg-secondary px-1.5 py-0.5 text-text-secondary"
          data-auto-density-suggestion-count={
            rollNormalizationPlan.autoDensitySuggestionRun?.frameSuggestions.length ?? 0
          }
          data-auto-density-suggestion-state={rollNormalizationPlan.autoDensitySuggestionRun?.state ?? 'suggested_only'}
          data-roll-normalization-anchor-frame-ids={rollNormalizationPlan.anchorFrameIds.join(',')}
          data-roll-normalization-warning-codes={rollNormalizationPlan.warningCodes.join(',')}
          data-testid="negative-lab-roll-normalization-plan"
        >
          {`${rollNormalizationPlan.affectedFrameIds.length} frames ${rollNormalizationPlan.proposedExposureDeltaEv >= 0 ? '+' : ''}${rollNormalizationPlan.proposedExposureDeltaEv.toFixed(2)} EV / WB ${rollNormalizationPlan.proposedWhiteBalanceDelta.toFixed(2)} / ${rollNormalizationPlan.autoDensitySuggestionRun?.state ?? 'suggested_only'}`}
        </span>
        <button
          type="button"
          aria-label={t('modals.negativeConversion.applyRollNormalizationPlan')}
          className="col-span-3 inline-flex items-center justify-center gap-1 rounded bg-bg-secondary px-1.5 py-0.5 text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
          data-roll-normalization-accepted={String(isRollNormalizationPlanAccepted)}
          data-testid="negative-lab-apply-roll-normalization"
          disabled={!isRollNormalizationPlanAccepted}
          onClick={handleApplyRollNormalizationPlan}
        >
          <WandSparkles size={11} />
          {t('modals.negativeConversion.applyRollNormalizationPlan')}
        </button>
        {rollNormalizationApplyReceipt !== null && (
          <span
            className="col-span-3 rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-text-secondary"
            data-accepted-dry-run-plan-hash={rollNormalizationApplyReceipt.acceptedDryRunPlanHash}
            data-accepted-dry-run-plan-id={rollNormalizationApplyReceipt.acceptedDryRunPlanId}
            data-applied-frame-count={rollNormalizationApplyReceipt.appliedFrameCount}
            data-exposure-override-count={rollNormalizationApplyReceipt.exposureOverrideCount}
            data-manual-exposure-preserved-frame-ids={rollNormalizationApplyReceipt.manualExposurePreservedFrameIds.join(
              ',',
            )}
            data-manual-rgb-preserved-frame-ids={rollNormalizationApplyReceipt.manualRgbPreservedFrameIds.join(',')}
            data-review-frame-count={rollNormalizationApplyReceipt.reviewFrameCount}
            data-restore-available={String(!rollNormalizationApplyReceipt.restored)}
            data-restore-revision={rollNormalizationApplyReceipt.restoreRevision}
            data-restored={String(rollNormalizationApplyReceipt.restored)}
            data-rgb-balance-override-count={rollNormalizationApplyReceipt.rgbBalanceOverrideCount}
            data-skipped-frame-count={rollNormalizationApplyReceipt.skippedFrameCount}
            data-testid="negative-lab-roll-normalization-apply-receipt"
          >
            {t('modals.negativeConversion.rollNormalizationApplyReceipt', {
              applyCount: rollNormalizationApplyReceipt.appliedFrameCount,
              planId: rollNormalizationApplyReceipt.acceptedDryRunPlanId,
              reviewCount: rollNormalizationApplyReceipt.reviewFrameCount,
              skippedCount: rollNormalizationApplyReceipt.skippedFrameCount,
            })}
          </span>
        )}
        <button
          type="button"
          aria-label={t('modals.negativeConversion.restoreRollNormalizationPlan')}
          className="col-span-3 inline-flex items-center justify-center gap-1 rounded bg-bg-secondary px-1.5 py-0.5 text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
          data-restore-available={String(
            rollNormalizationApplyReceipt !== null && !rollNormalizationApplyReceipt.restored,
          )}
          data-testid="negative-lab-restore-roll-normalization"
          disabled={rollNormalizationApplyReceipt === null || rollNormalizationApplyReceipt.restored}
          onClick={handleRestoreRollNormalizationPlan}
        >
          <RotateCcw size={11} />
          {t('modals.negativeConversion.restoreRollNormalizationPlan')}
        </button>
        {rollNormalizationRestoreReceipt !== null && (
          <span
            className="col-span-3 rounded border border-blue-400/30 bg-blue-500/10 px-1.5 py-0.5 text-text-secondary"
            data-accepted-dry-run-plan-hash={rollNormalizationRestoreReceipt.acceptedDryRunPlanHash}
            data-accepted-dry-run-plan-id={rollNormalizationRestoreReceipt.acceptedDryRunPlanId}
            data-restored-exposure-override-count={rollNormalizationRestoreReceipt.restoredExposureOverrideCount}
            data-restored-frame-count={rollNormalizationRestoreReceipt.restoredFrameCount}
            data-restored-revision={rollNormalizationRestoreReceipt.restoredRevision}
            data-restored-rgb-balance-override-count={rollNormalizationRestoreReceipt.restoredRgbBalanceOverrideCount}
            data-testid="negative-lab-roll-normalization-restore-receipt"
          >
            {t('modals.negativeConversion.rollNormalizationRestoreReceipt', {
              frameCount: rollNormalizationRestoreReceipt.restoredFrameCount,
              planId: rollNormalizationRestoreReceipt.acceptedDryRunPlanId,
              revision: rollNormalizationRestoreReceipt.restoredRevision,
            })}
          </span>
        )}
        <button
          type="button"
          aria-label={
            isBatchPlanCopied
              ? t('modals.negativeConversion.batchPlanCopied')
              : t('modals.negativeConversion.copyBatchPlan')
          }
          className="col-span-3 inline-flex items-center justify-center gap-1 rounded bg-bg-secondary px-1.5 py-0.5 text-text-secondary transition-colors hover:bg-surface"
          data-testid="negative-lab-copy-batch-plan"
          onClick={() => {
            void handleCopyBatchPlan();
          }}
        >
          <Copy size={11} />
          {isBatchPlanCopied
            ? t('modals.negativeConversion.batchPlanCopied')
            : t('modals.negativeConversion.copyBatchPlan')}
        </button>
        <button
          type="button"
          aria-label={
            isBatchPlanAccepted
              ? t('modals.negativeConversion.batchPlanAccepted')
              : t('modals.negativeConversion.acceptBatchPlan')
          }
          className={cx(
            'col-span-3 inline-flex items-center justify-center rounded px-1.5 py-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            isBatchPlanAccepted
              ? 'bg-accent/15 text-text-primary'
              : 'bg-bg-secondary text-text-secondary hover:bg-surface',
          )}
          data-testid="negative-lab-accept-batch-plan"
          disabled={batchDryRunSummary.blocked}
          onClick={handleAcceptBatchPlan}
        >
          {isBatchPlanAccepted
            ? t('modals.negativeConversion.batchPlanAccepted')
            : t('modals.negativeConversion.acceptBatchPlan')}
        </button>
        {batchPlanStaleReasons.length > 0 && (
          <span
            className="col-span-3 rounded border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-yellow-100"
            data-stale-plan-reasons={batchPlanStaleReasons.join(',')}
            data-testid="negative-lab-batch-plan-stale-reasons"
            role="status"
          >
            {t('modals.negativeConversion.batchPlanStaleReasons', {
              reasons: batchPlanStaleReasons
                .map((reason) => t(`modals.negativeConversion.batchPlanStaleReason.${reason}`))
                .join(', '),
            })}
          </span>
        )}
        <button
          type="button"
          aria-label={t('modals.negativeConversion.applyBatchPlan')}
          className="col-span-3 inline-flex items-center justify-center gap-1 rounded bg-bg-secondary px-1.5 py-0.5 text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
          data-accepted-plan-required="true"
          data-accepted-plan-state={
            isBatchPlanAccepted ? 'current' : batchPlanStaleReasons.length > 0 ? 'stale' : 'missing'
          }
          data-stale-plan-reasons={batchPlanStaleReasons.join(',')}
          data-testid="negative-lab-apply-batch-plan"
          disabled={!isBatchPlanAccepted}
          onClick={handleApplyBatchPlan}
        >
          <Images size={11} />
          {t('modals.negativeConversion.applyBatchPlan')}
        </button>
        {batchApplyReceipt !== null && (
          <span
            className="col-span-3 rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-text-secondary"
            data-accepted-dry-run-plan-hash={batchApplyReceipt.acceptedDryRunPlanHash}
            data-accepted-dry-run-plan-id={batchApplyReceipt.acceptedDryRunPlanId}
            data-applied-positive-count={batchApplyReceipt.appliedPositiveCount}
            data-contact-sheet-artifact-id={batchApplyReceipt.contactSheetArtifactId}
            data-editor-handoff-open={String(batchApplyReceipt.editorHandoff.openInEditor)}
            data-generated-proof-id={batchApplyReceipt.generatedProofId}
            data-planned-apply-count={batchApplyReceipt.plannedApplyCount}
            data-proof-warning-count={batchApplyReceipt.proofWarningCount}
            data-queued-frame-count={batchApplyReceipt.queuedFrameCount}
            data-review-frame-count={batchApplyReceipt.reviewFrameCount}
            data-saved-path-count={batchApplyReceipt.savedPaths.length}
            data-skipped-frame-count={batchApplyReceipt.skippedFrameCount}
            data-testid="negative-lab-batch-apply-receipt"
          >
            {t('modals.negativeConversion.batchApplyReceipt', {
              applyCount: batchApplyReceipt.appliedPositiveCount,
              planId: batchApplyReceipt.acceptedDryRunPlanId,
              savedCount: batchApplyReceipt.savedPaths.length,
            })}
          </span>
        )}
        {batchApplyReceipt !== null && batchApplyReceipt.appliedPositives.length > 0 && (
          <div
            className="col-span-3 grid gap-1 rounded border border-accent/20 bg-bg-secondary p-1.5"
            data-per-frame-receipt-count={batchApplyReceipt.appliedPositives.length}
            data-roll-receipt-id={batchApplyReceipt.generatedProofId}
            data-testid="negative-lab-batch-per-frame-receipts"
          >
            {batchApplyReceipt.appliedPositives.map((positive) => (
              <span
                className="truncate rounded bg-bg-primary px-1.5 py-0.5 text-text-tertiary"
                data-frame-id={positive.frameId}
                data-generated-artifact-id={positive.generatedArtifactId}
                data-output-intent={positive.outputIntent}
                data-saved-path={positive.savedPath ?? ''}
                data-source-path={positive.sourcePath}
                data-testid={`negative-lab-batch-frame-receipt-${positive.frameId}`}
                data-warning-codes={positive.warningCodes.join(',')}
                key={positive.frameId}
                title={positive.savedPath ?? positive.sourcePath}
              >
                {t('modals.negativeConversion.batchFrameApplyReceipt', {
                  frameId: positive.frameId,
                  savedPath: positive.savedPath ?? t('modals.negativeConversion.batchFrameApplyReceiptUnsaved'),
                })}
              </span>
            ))}
          </div>
        )}
      </div>
      <div
        className="grid grid-cols-2 gap-2 rounded-sm bg-bg-secondary p-2 text-[11px]"
        aria-label={t('modals.negativeConversion.frameHealth')}
        data-filter={frameHealthFilter}
        data-sort={frameHealthSort}
        data-testid="negative-lab-frame-health-controls"
        role="group"
      >
        <label className="space-y-1">
          <span className="block text-text-tertiary">{t('modals.negativeConversion.frameHealthSeverityFilter')}</span>
          <select
            aria-label={t('modals.negativeConversion.frameHealthSeverityFilter')}
            className="w-full rounded border border-surface bg-bg-primary px-2 py-1 text-text-secondary"
            data-testid="negative-lab-frame-health-filter"
            onChange={(event) => {
              if (isNegativeLabFrameHealthFilter(event.target.value)) setFrameHealthFilter(event.target.value);
            }}
            value={frameHealthFilter}
          >
            {NEGATIVE_LAB_FRAME_HEALTH_FILTERS.map((filter) => (
              <option key={filter} value={filter}>
                {t(`modals.negativeConversion.frameHealthFilter.${filter}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-text-tertiary">{t('modals.negativeConversion.frameHealthSort')}</span>
          <select
            aria-label={t('modals.negativeConversion.frameHealthSort')}
            className="w-full rounded border border-surface bg-bg-primary px-2 py-1 text-text-secondary"
            data-testid="negative-lab-frame-health-sort"
            onChange={(event) => {
              if (isNegativeLabFrameHealthSort(event.target.value)) setFrameHealthSort(event.target.value);
            }}
            value={frameHealthSort}
          >
            {NEGATIVE_LAB_FRAME_HEALTH_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {t(`modals.negativeConversion.frameHealthSortModes.${sort}`)}
              </option>
            ))}
          </select>
        </label>
        <span className="col-span-2 text-text-tertiary" data-testid="negative-lab-frame-health-visible-count">
          {t('modals.negativeConversion.frameHealthVisibleCount', {
            total: frameHealthReport.frames.length,
            visibleCount: visibleFrameHealthRows.length,
          })}
        </span>
        <div
          className="col-span-2 grid grid-cols-3 gap-1"
          aria-label={t('modals.negativeConversion.frameHealth')}
          data-visible-frame-count={visibleFrameHealthRows.length}
          data-testid="negative-lab-qc-visible-actions"
          role="group"
        >
          {(
            [
              {
                decision: 'approved',
                label: t('modals.negativeConversion.qcDecisionApproveVisible', {
                  count: visibleFrameHealthRows.length,
                }),
                testId: 'negative-lab-qc-approved-visible',
              },
              {
                decision: 'rejected',
                label: t('modals.negativeConversion.qcDecisionRejectVisible', {
                  count: visibleFrameHealthRows.length,
                }),
                testId: 'negative-lab-qc-rejected-visible',
              },
              {
                decision: 'pending',
                label: t('modals.negativeConversion.qcDecisionResetVisible', {
                  count: visibleFrameHealthRows.length,
                }),
                testId: 'negative-lab-qc-pending-visible',
              },
            ] satisfies Array<{ decision: NegativeLabQcDecision; label: string; testId: string }>
          ).map(({ decision, label, testId }) => (
            <button
              className="rounded bg-bg-primary px-1.5 py-1 text-text-tertiary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
              data-testid={testId}
              disabled={visibleFrameHealthRows.length === 0}
              key={decision}
              onClick={() => {
                handleSetVisibleQcDecision(decision);
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-1">
        {visibleFrameHealthRows.map((row, index) => {
          const exposureOffset = snapNegativeLabFrameExposureOffset(frameExposureOffsetByFrameId[row.frameId] ?? 0);
          const rgbBalanceOffset = snapNegativeLabFrameRgbBalanceOffsets({
            baselineParams: params,
            offsets: frameRgbBalanceOffsetByFrameId[row.frameId],
          });
          const rgbBalanceIsZero = negativeLabFrameRgbBalanceOffsetIsZero(rgbBalanceOffset);

          return (
            <div
              aria-label={`${row.scanLabel}, ${t(`modals.negativeConversion.frameWarningSeverity.${row.warningSeverity}`)}, ${t(
                BATCH_DISPOSITION_LABEL_KEYS[row.batchDisposition],
              )}`}
              className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto_auto_auto_auto] items-center gap-2 rounded-sm bg-bg-secondary px-2 py-1 text-xs"
              data-acquisition-source={row.acquisitionSourceFamily}
              data-conversion-status={row.conversionStatus}
              data-crop-status={row.cropStatus}
              data-disposition={row.batchDisposition}
              data-qc-status={row.qcStatus}
              data-severity={row.warningSeverity}
              data-warning-count={getNegativeLabFrameWarningCount(row)}
              data-testid={`negative-lab-frame-health-row-${index}`}
              key={row.frameId}
              role="group"
            >
              <span className="truncate text-text-secondary">{row.scanLabel}</span>
              <span
                className={cx(
                  'rounded px-1.5 py-0.5',
                  row.acquisitionWarningCodes.length > 0
                    ? 'bg-yellow-500/15 text-yellow-200'
                    : 'bg-surface text-text-secondary',
                )}
                data-testid={`negative-lab-frame-source-${index}`}
              >
                {t(ACQUISITION_SOURCE_FAMILY_LABEL_KEYS[row.acquisitionSourceFamily])}
              </span>
              <span
                className={cx(
                  'rounded px-1.5 py-0.5',
                  row.warningSeverity === 'review' && 'bg-yellow-500/15 text-yellow-200',
                  row.warningSeverity === 'info' && 'bg-blue-500/15 text-blue-200',
                  row.warningSeverity === 'ok' && 'bg-surface text-text-secondary',
                )}
                data-testid={`negative-lab-frame-severity-${index}`}
              >
                {t(`modals.negativeConversion.frameWarningSeverity.${row.warningSeverity}`)}
              </span>
              <span
                className={cx(
                  'rounded px-1.5 py-0.5',
                  row.healthStatus === 'active' && 'bg-accent/15 text-text-primary',
                  row.healthStatus === 'queued' && 'bg-surface text-text-secondary',
                  row.healthStatus === 'skipped' && 'bg-bg-primary text-text-tertiary',
                )}
                data-testid={`negative-lab-frame-health-status-${index}`}
              >
                {t(
                  row.healthStatus === 'skipped'
                    ? 'modals.negativeConversion.frameHealthSkipped'
                    : row.healthStatus === 'active'
                      ? 'modals.negativeConversion.frameHealthActive'
                      : 'modals.negativeConversion.frameHealthQueued',
                )}
              </span>
              <span className="text-text-tertiary">
                {row.baseStatus === 'estimated' && row.baseConfidence !== null
                  ? t(
                      row.baseScope === 'roll'
                        ? 'modals.negativeConversion.baseReadyRoll'
                        : 'modals.negativeConversion.baseReadyFrame',
                      { confidence: Math.round(row.baseConfidence * 100) },
                    )
                  : t('modals.negativeConversion.basePending')}
              </span>
              <span
                className="flex items-center gap-1 text-text-tertiary"
                data-testid={`negative-lab-frame-crop-status-${index}`}
              >
                <span>{t(`modals.negativeConversion.frameCropStatus.${row.cropStatus}`)}</span>
                {row.active && (
                  <span className="inline-flex gap-1" data-testid="negative-lab-active-frame-crop-actions">
                    <button
                      aria-label={t('modals.negativeConversion.acceptDetectedCrop')}
                      className="rounded bg-bg-primary px-1 py-0.5 transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid="negative-lab-accept-detected-crop"
                      disabled={isSaving}
                      onClick={() => {
                        handleSetActiveFrameCropStatus('detected_frame');
                      }}
                      type="button"
                    >
                      {t('modals.negativeConversion.acceptDetectedCrop')}
                    </button>
                    <button
                      aria-label={t('modals.negativeConversion.manualCrop')}
                      className="rounded bg-bg-primary px-1 py-0.5 transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid="negative-lab-set-manual-crop"
                      disabled={isSaving}
                      onClick={() => {
                        handleSetActiveFrameCropStatus('manual_override');
                      }}
                      type="button"
                    >
                      {t('modals.negativeConversion.manualCrop')}
                    </button>
                    <button
                      aria-label={t('modals.negativeConversion.resetFrameCrop')}
                      className="rounded bg-bg-primary px-1 py-0.5 transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid="negative-lab-reset-frame-crop"
                      disabled={isSaving || row.cropStatus === 'active_frame_editable'}
                      onClick={() => {
                        handleSetActiveFrameCropStatus('active_frame_editable');
                      }}
                      type="button"
                    >
                      {t('modals.negativeConversion.resetFrameCrop')}
                    </button>
                  </span>
                )}
              </span>
              <span className="text-text-tertiary" data-testid={`negative-lab-frame-conversion-status-${index}`}>
                {t(`modals.negativeConversion.frameConversionStatus.${row.conversionStatus}`)}
              </span>
              <span
                className={cx(
                  'rounded px-1.5 py-0.5',
                  row.batchDisposition === 'apply' && 'bg-accent/15 text-text-primary',
                  row.batchDisposition === 'review' && 'bg-yellow-500/15 text-yellow-200',
                  row.batchDisposition === 'skip' && 'bg-bg-primary text-text-tertiary',
                )}
                data-testid={`negative-lab-frame-disposition-${index}`}
                title={t(BATCH_DISPOSITION_REASON_LABEL_KEYS[row.batchDispositionReason])}
              >
                {t(BATCH_DISPOSITION_LABEL_KEYS[row.batchDisposition])}
              </span>
              <span className="text-text-tertiary" data-testid={`negative-lab-frame-qc-status-${index}`}>
                {t(`modals.negativeConversion.frameQcStatus.${row.qcStatus}`)}
              </span>
              <span
                className={cx(
                  'rounded px-1.5 py-0.5 tabular-nums',
                  exposureOffset === 0 ? 'bg-bg-primary text-text-tertiary' : 'bg-blue-500/15 text-blue-200',
                )}
                data-exposure-offset={exposureOffset}
                data-testid={`negative-lab-frame-exposure-override-${index}`}
              >
                {formatSignedRecipeValue(exposureOffset)}
              </span>
              <span
                className={cx(
                  'rounded px-1.5 py-0.5 tabular-nums',
                  rgbBalanceIsZero ? 'bg-bg-primary text-text-tertiary' : 'bg-fuchsia-500/15 text-fuchsia-200',
                )}
                data-testid={`negative-lab-frame-rgb-balance-override-${index}`}
              >
                {rgbBalanceIsZero ? 'RGB 0.00' : `RGB ${formatSignedRecipeValue(rgbBalanceOffset.redWeight)}`}
              </span>
              <span
                className="col-span-10 flex flex-wrap items-center gap-1 text-[11px]"
                aria-label={`${row.scanLabel} ${t(QC_DECISION_LABEL_KEYS[qcDecisionByFrameId[row.frameId] ?? 'pending'])}`}
                data-qc-decision={qcDecisionByFrameId[row.frameId] ?? 'pending'}
                data-testid={`negative-lab-frame-qc-decision-${index}`}
                role="group"
              >
                <span className="mr-1 text-text-tertiary">
                  {t(QC_DECISION_LABEL_KEYS[qcDecisionByFrameId[row.frameId] ?? 'pending'])}
                </span>
                {(['approved', 'rejected', 'pending'] satisfies Array<NegativeLabQcDecision>).map((decision) => (
                  <button
                    aria-label={`${row.scanLabel}: ${t(QC_DECISION_LABEL_KEYS[decision])}`}
                    className={cx(
                      'rounded px-1.5 py-0.5 transition-colors',
                      (qcDecisionByFrameId[row.frameId] ?? 'pending') === decision
                        ? 'bg-accent/15 text-text-primary'
                        : 'bg-bg-primary text-text-tertiary hover:bg-surface',
                    )}
                    data-testid={`negative-lab-frame-qc-${decision}-${row.frameId}`}
                    key={decision}
                    onClick={() => {
                      handleSetQcDecision(row.frameId, decision);
                    }}
                    type="button"
                  >
                    {t(QC_DECISION_LABEL_KEYS[decision])}
                  </button>
                ))}
              </span>
              {getNegativeLabFrameWarningCount(row) > 0 && (
                <span
                  className="col-span-8 flex flex-wrap gap-1"
                  data-testid={`negative-lab-frame-warning-row-${index}`}
                >
                  {row.warningCodes.map((warningCode) => (
                    <span
                      className="rounded bg-bg-primary px-1.5 py-0.5 text-[11px] text-text-tertiary"
                      data-testid={`negative-lab-frame-warning-chip-${warningCode}`}
                      key={warningCode}
                    >
                      {warningCode === 'base_estimate_active_frame_only'
                        ? t('modals.negativeConversion.frameWarningBaseEstimateActiveOnly')
                        : warningCode === 'excluded_from_batch'
                          ? t('modals.negativeConversion.frameWarningExcluded')
                          : t('modals.negativeConversion.frameWarningPreviewNotReady')}
                    </span>
                  ))}
                  {row.acquisitionWarningCodes.map((warningCode) => (
                    <span
                      className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[11px] text-yellow-200"
                      data-testid={`negative-lab-frame-acquisition-warning-chip-${warningCode}`}
                      key={warningCode}
                    >
                      {t(ACQUISITION_WARNING_LABEL_KEYS[warningCode])}
                    </span>
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
