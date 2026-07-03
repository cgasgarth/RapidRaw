import cx from 'clsx';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NegativeLabHighlightPatchExposureSuggestion } from '../../../schemas/negative-lab/negativeLabHighlightPatchExposureSuggestionSchemas';
import type { NegativeLabNeutralPatchSuggestion } from '../../../schemas/negative-lab/negativeLabNeutralPatchSuggestionSchemas';
import type {
  NegativeBaseFogDensitometerReadout,
  NegativeBaseFogEstimate,
  NegativeBaseFogSampleReadout,
  NegativeLabBaseFogSampleRect,
} from '../../../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import type { NegativeLabShadowPatchBlackPointSuggestion } from '../../../schemas/negative-lab/negativeLabShadowPatchBlackPointSuggestionSchemas';
import { TextVariants } from '../../../types/typography';
import {
  type DensitometerPatchLabelKey,
  NEGATIVE_LAB_DENSITOMETER_PATCH_PRESETS,
  NEGATIVE_LAB_PATCH_ROLES,
  type NegativeLabPatchRole,
} from '../../../utils/negative-lab/negativeLabPatchSamplerUi';
import UiText from '../../ui/primitives/Text';

const DENSITOMETER_CHANNEL_LABEL_KEYS: Record<
  NegativeBaseFogDensitometerReadout['dominantChannel'],
  | 'modals.negativeConversion.densitometerChannelBlue'
  | 'modals.negativeConversion.densitometerChannelGreen'
  | 'modals.negativeConversion.densitometerChannelRed'
> = {
  blue: 'modals.negativeConversion.densitometerChannelBlue',
  green: 'modals.negativeConversion.densitometerChannelGreen',
  red: 'modals.negativeConversion.densitometerChannelRed',
};

interface NegativeLabPatchSamplerPanelProps {
  activeFrameId: string | null;
  formatDensityValue: (value: number) => string;
  formatPercentValue: (value: number) => string;
  formatRgbValue: (value: number) => string;
  formatSignedRecipeValue: (value: number) => string;
  highlightPatchExposureSuggestion: NegativeLabHighlightPatchExposureSuggestion | null;
  isPickingPatch: boolean;
  isSamplingPatchProbe: boolean;
  isSaving: boolean;
  isSuggestingHighlightPatchExposure: boolean;
  isSuggestingNeutralPatchRgb: boolean;
  isSuggestingShadowPatchBlackPoint: boolean;
  neutralPatchSuggestion: NegativeLabNeutralPatchSuggestion | null;
  onApplyHighlightPatchExposureSuggestion: () => void;
  onApplyNeutralPatchRgbSuggestion: () => void;
  onApplyShadowPatchBlackPointSuggestion: () => void;
  onPatchRoleChange: (role: NegativeLabPatchRole) => void;
  onSamplePatchProbe: (labelKey: DensitometerPatchLabelKey, sampleRect: NegativeLabBaseFogSampleRect) => void;
  onSuggestHighlightPatchExposure: () => void;
  onSuggestNeutralPatchRgb: () => void;
  onSuggestShadowPatchBlackPoint: () => void;
  onTogglePatchPick: () => void;
  patchProbeDensitometerReadout: NegativeBaseFogDensitometerReadout | null;
  patchProbeEstimate: NegativeBaseFogEstimate | null;
  patchProbeSampleReadout: NegativeBaseFogSampleReadout | null;
  patchRole: NegativeLabPatchRole;
  selectedImagePath: string | null;
  shadowPatchBlackPointSuggestion: NegativeLabShadowPatchBlackPointSuggestion | null;
}

export function NegativeLabPatchSamplerPanel({
  activeFrameId,
  formatDensityValue,
  formatPercentValue,
  formatRgbValue,
  formatSignedRecipeValue,
  highlightPatchExposureSuggestion,
  isPickingPatch,
  isSamplingPatchProbe,
  isSaving,
  isSuggestingHighlightPatchExposure,
  isSuggestingNeutralPatchRgb,
  isSuggestingShadowPatchBlackPoint,
  neutralPatchSuggestion,
  onApplyHighlightPatchExposureSuggestion,
  onApplyNeutralPatchRgbSuggestion,
  onApplyShadowPatchBlackPointSuggestion,
  onPatchRoleChange,
  onSamplePatchProbe,
  onSuggestHighlightPatchExposure,
  onSuggestNeutralPatchRgb,
  onSuggestShadowPatchBlackPoint,
  onTogglePatchPick,
  patchProbeDensitometerReadout,
  patchProbeEstimate,
  patchProbeSampleReadout,
  patchRole,
  selectedImagePath,
  shadowPatchBlackPointSuggestion,
}: NegativeLabPatchSamplerPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 rounded-md border border-surface bg-bg-primary p-2">
      <div>
        <UiText variant={TextVariants.small} className="text-text-secondary">
          {t('modals.negativeConversion.patchSampler')}
        </UiText>
        <UiText variant={TextVariants.small} className="text-text-tertiary">
          {t('modals.negativeConversion.patchSamplerHint')}
        </UiText>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {NEGATIVE_LAB_DENSITOMETER_PATCH_PRESETS.map((samplePreset) => (
          <button
            key={samplePreset.labelKey}
            type="button"
            data-testid={samplePreset.testId}
            onClick={() => {
              onSamplePatchProbe(samplePreset.labelKey, samplePreset.rect);
            }}
            disabled={!selectedImagePath || isSamplingPatchProbe || isSaving}
            className="rounded-md border border-surface bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(samplePreset.labelKey)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2" data-testid="negative-lab-patch-role-selector">
        {NEGATIVE_LAB_PATCH_ROLES.map((role) => (
          <button
            key={role}
            type="button"
            className={cx(
              'rounded-md border px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              patchRole === role
                ? 'border-accent bg-accent/10 text-text-primary'
                : 'border-surface bg-bg-secondary text-text-secondary hover:bg-surface',
            )}
            data-testid={`negative-lab-patch-role-${role}`}
            disabled={isSaving}
            onClick={() => {
              onPatchRoleChange(role);
            }}
          >
            {t(`modals.negativeConversion.patchRole.${role}`)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-surface bg-bg-secondary px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="negative-lab-pick-viewer-patch"
        data-picking={String(isPickingPatch)}
        disabled={!selectedImagePath || isSaving}
        onClick={onTogglePatchPick}
      >
        {t(isPickingPatch ? 'modals.negativeConversion.cancelPatchPick' : 'modals.negativeConversion.pickViewerPatch')}
      </button>
      {patchProbeEstimate !== null && patchProbeDensitometerReadout !== null && patchProbeSampleReadout !== null && (
        <div
          className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-surface bg-bg-secondary p-2 text-xs text-text-tertiary"
          data-testid="negative-lab-patch-probe-readout"
        >
          <span className="text-text-secondary">{patchProbeSampleReadout.label}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-patch-probe-area">
            {t('modals.negativeConversion.baseSampleArea', {
              area: formatPercentValue(patchProbeSampleReadout.areaPercent),
            })}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.baseRgb')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-patch-probe-rgb">
            {patchProbeEstimate.baseRgb.map(formatRgbValue).join(' / ')}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.confidence')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-patch-probe-confidence">
            {formatPercentValue(patchProbeEstimate.confidence * 100)}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.densitometer')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-patch-probe-density-spread">
            {formatDensityValue(patchProbeDensitometerReadout.densityRange)}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.densitometerDominant')}</span>
          <span className="text-right" data-testid="negative-lab-patch-probe-dominant-channel">
            {t(DENSITOMETER_CHANNEL_LABEL_KEYS[patchProbeDensitometerReadout.dominantChannel])}
          </span>
          <button
            type="button"
            className="col-span-2 mt-1 inline-flex items-center justify-center gap-1 rounded border border-surface bg-bg-primary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="negative-lab-suggest-neutral-patch-rgb"
            disabled={isSuggestingNeutralPatchRgb || isSaving}
            onClick={onSuggestNeutralPatchRgb}
          >
            {isSuggestingNeutralPatchRgb ? <Loader2 size={12} className="animate-spin" /> : null}
            {t('modals.negativeConversion.suggestNeutralPatchRgb')}
          </button>
          <button
            type="button"
            className="col-span-2 inline-flex items-center justify-center gap-1 rounded border border-surface bg-bg-primary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="negative-lab-analyze-highlight-recovery"
            disabled={isSuggestingHighlightPatchExposure || isSaving}
            onClick={onSuggestHighlightPatchExposure}
          >
            {isSuggestingHighlightPatchExposure ? <Loader2 size={12} className="animate-spin" /> : null}
            {t('modals.negativeConversion.analyzeHighlightRecovery')}
          </button>
          <button
            type="button"
            className="col-span-2 inline-flex items-center justify-center gap-1 rounded border border-surface bg-bg-primary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="negative-lab-analyze-shadow-black-point"
            disabled={isSuggestingShadowPatchBlackPoint || isSaving}
            onClick={onSuggestShadowPatchBlackPoint}
          >
            {isSuggestingShadowPatchBlackPoint ? <Loader2 size={12} className="animate-spin" /> : null}
            {t('modals.negativeConversion.analyzeShadowBlackPoint')}
          </button>
        </div>
      )}
      {shadowPatchBlackPointSuggestion !== null && (
        <div
          className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-surface bg-bg-secondary p-2 text-xs text-text-tertiary"
          data-application-risk={shadowPatchBlackPointSuggestion.applicationRisk}
          data-apply-allowed={String(shadowPatchBlackPointSuggestion.applyAllowed)}
          data-status={shadowPatchBlackPointSuggestion.status}
          data-testid="negative-lab-shadow-black-point-suggestion"
        >
          <span className="text-text-secondary">{t('modals.negativeConversion.shadowBlackPointSuggestion')}</span>
          <span className="text-right" data-testid="negative-lab-shadow-black-point-status">
            {t(`modals.negativeConversion.highlightRecoveryStatus.${shadowPatchBlackPointSuggestion.status}`)}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.blackPoint')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-shadow-black-point-value">
            {shadowPatchBlackPointSuggestion.projectedBlackPoint.toFixed(2)}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.suggestedDelta')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-shadow-black-point-delta">
            {formatSignedRecipeValue(shadowPatchBlackPointSuggestion.suggestedBlackPointDelta)}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.shadowBlackPointP01')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-shadow-black-point-p01">
            {t('modals.negativeConversion.highlightRecoveryValueTransition', {
              from: shadowPatchBlackPointSuggestion.currentSampleP01MinChannel.toFixed(3),
              to: shadowPatchBlackPointSuggestion.projectedSampleP01MinChannel.toFixed(3),
            })}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.applicationRisk')}</span>
          <span className="text-right" data-testid="negative-lab-shadow-black-point-risk">
            {t(`modals.negativeConversion.neutralityRiskLevels.${shadowPatchBlackPointSuggestion.applicationRisk}`)}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.currentProjectedRgb')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-shadow-black-point-rgb">
            {t('modals.negativeConversion.highlightRecoveryValueTransition', {
              from: shadowPatchBlackPointSuggestion.currentSampleRgb.map(formatRgbValue).join(' / '),
              to: shadowPatchBlackPointSuggestion.projectedSampleRgb.map(formatRgbValue).join(' / '),
            })}
          </span>
          {shadowPatchBlackPointSuggestion.endpointClamped || !shadowPatchBlackPointSuggestion.applyAllowed ? (
            <span
              className="col-span-2 text-[11px] text-warning"
              data-testid="negative-lab-shadow-black-point-apply-warning"
            >
              {t('modals.negativeConversion.shadowBlackPointApplyWarning')}
            </span>
          ) : null}
          <button
            type="button"
            className="col-span-2 mt-1 inline-flex items-center justify-center rounded border border-accent bg-accent/10 px-2 py-1 text-[11px] text-text-primary transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="negative-lab-apply-shadow-black-point"
            disabled={isSaving || !shadowPatchBlackPointSuggestion.applyAllowed}
            onClick={onApplyShadowPatchBlackPointSuggestion}
          >
            {t('modals.negativeConversion.applyShadowBlackPoint')}
          </button>
        </div>
      )}
      {highlightPatchExposureSuggestion !== null && (
        <div
          className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-surface bg-bg-secondary p-2 text-xs text-text-tertiary"
          data-application-risk={highlightPatchExposureSuggestion.applicationRisk}
          data-apply-allowed={String(highlightPatchExposureSuggestion.applyAllowed)}
          data-status={highlightPatchExposureSuggestion.status}
          data-testid="negative-lab-highlight-recovery-suggestion"
        >
          <span className="text-text-secondary">{t('modals.negativeConversion.highlightRecoverySuggestion')}</span>
          <span className="text-right" data-testid="negative-lab-highlight-recovery-status">
            {t(`modals.negativeConversion.highlightRecoveryStatus.${highlightPatchExposureSuggestion.status}`)}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.highlightRecoveryOffset')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-highlight-recovery-offset">
            {formatSignedRecipeValue(highlightPatchExposureSuggestion.suggestedFrameExposureOffset)}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.suggestedDelta')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-highlight-recovery-delta">
            {formatSignedRecipeValue(highlightPatchExposureSuggestion.suggestedExposureDeltaEv)}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.highlightRecoveryP99')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-highlight-recovery-p99">
            {t('modals.negativeConversion.highlightRecoveryValueTransition', {
              from: highlightPatchExposureSuggestion.currentSampleP99MaxChannel.toFixed(3),
              to: highlightPatchExposureSuggestion.projectedSampleP99MaxChannel.toFixed(3),
            })}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.highlightRecoveryPatchClipped')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-highlight-recovery-patch-clipped">
            {t('modals.negativeConversion.highlightRecoveryValueTransition', {
              from: formatPercentValue(highlightPatchExposureSuggestion.currentSampleClippedFraction * 100),
              to: formatPercentValue(highlightPatchExposureSuggestion.projectedSampleClippedFraction * 100),
            })}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.applicationRisk')}</span>
          <span className="text-right" data-testid="negative-lab-highlight-recovery-risk">
            {t(`modals.negativeConversion.neutralityRiskLevels.${highlightPatchExposureSuggestion.applicationRisk}`)}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.currentProjectedRgb')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-highlight-recovery-rgb">
            {t('modals.negativeConversion.highlightRecoveryValueTransition', {
              from: highlightPatchExposureSuggestion.currentSampleRgb.map(formatRgbValue).join(' / '),
              to: highlightPatchExposureSuggestion.projectedSampleRgb.map(formatRgbValue).join(' / '),
            })}
          </span>
          {highlightPatchExposureSuggestion.offsetClamped || !highlightPatchExposureSuggestion.applyAllowed ? (
            <span
              className="col-span-2 text-[11px] text-warning"
              data-testid="negative-lab-highlight-recovery-apply-warning"
            >
              {t('modals.negativeConversion.highlightRecoveryApplyWarning')}
            </span>
          ) : null}
          <button
            type="button"
            className="col-span-2 mt-1 inline-flex items-center justify-center rounded border border-accent bg-accent/10 px-2 py-1 text-[11px] text-text-primary transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="negative-lab-apply-highlight-recovery"
            disabled={activeFrameId === null || isSaving || !highlightPatchExposureSuggestion.applyAllowed}
            onClick={onApplyHighlightPatchExposureSuggestion}
          >
            {t('modals.negativeConversion.applyHighlightRecovery')}
          </button>
        </div>
      )}
      {neutralPatchSuggestion !== null && (
        <div
          className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-surface bg-bg-secondary p-2 text-xs text-text-tertiary"
          data-application-risk={neutralPatchSuggestion.applicationRisk}
          data-apply-allowed={String(neutralPatchSuggestion.applyAllowed)}
          data-neutrality-risk={neutralPatchSuggestion.neutralityRisk}
          data-testid="negative-lab-neutral-patch-rgb-suggestion"
        >
          <span className="text-text-secondary">{t('modals.negativeConversion.neutralPatchRgbSuggestion')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-neutral-patch-rgb-offset">
            {t('modals.negativeConversion.effectiveFrameRgbBalance', {
              blue: formatSignedRecipeValue(neutralPatchSuggestion.suggestedRgbBalanceOffset.blueWeight),
              green: formatSignedRecipeValue(neutralPatchSuggestion.suggestedRgbBalanceOffset.greenWeight),
              red: formatSignedRecipeValue(neutralPatchSuggestion.suggestedRgbBalanceOffset.redWeight),
            })}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.confidence')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-neutral-patch-confidence">
            {formatPercentValue(neutralPatchSuggestion.confidence * 100)}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.baseRgb')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-neutral-patch-sample-rgb">
            {neutralPatchSuggestion.sampleRgb.map(formatRgbValue).join(' / ')}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.frameRgbBalanceOffset')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-neutral-patch-effective-balance">
            {t('modals.negativeConversion.effectiveFrameRgbBalance', {
              blue: formatRgbValue(neutralPatchSuggestion.effectiveRgbBalance.blueWeight),
              green: formatRgbValue(neutralPatchSuggestion.effectiveRgbBalance.greenWeight),
              red: formatRgbValue(neutralPatchSuggestion.effectiveRgbBalance.redWeight),
            })}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.neutralityRisk')}</span>
          <span className="text-right" data-testid="negative-lab-neutral-patch-risk">
            {t(`modals.negativeConversion.neutralityRiskLevels.${neutralPatchSuggestion.neutralityRisk}`)}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.applicationRisk')}</span>
          <span className="text-right" data-testid="negative-lab-neutral-patch-application-risk">
            {t(`modals.negativeConversion.neutralityRiskLevels.${neutralPatchSuggestion.applicationRisk}`)}
          </span>
          <span className="text-text-secondary">{t('modals.negativeConversion.correctionMagnitude')}</span>
          <span className="text-right tabular-nums" data-testid="negative-lab-neutral-patch-correction-magnitude">
            {formatSignedRecipeValue(neutralPatchSuggestion.correctionMagnitude)}
          </span>
          {neutralPatchSuggestion.offsetClamped || !neutralPatchSuggestion.applyAllowed ? (
            <span
              className="col-span-2 text-[11px] text-warning"
              data-testid="negative-lab-neutral-patch-apply-warning"
            >
              {t('modals.negativeConversion.neutralPatchApplyWarning')}
            </span>
          ) : null}
          <button
            type="button"
            className="col-span-2 mt-1 inline-flex items-center justify-center rounded border border-accent bg-accent/10 px-2 py-1 text-[11px] text-text-primary transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="negative-lab-apply-neutral-patch-rgb"
            disabled={activeFrameId === null || isSaving || !neutralPatchSuggestion.applyAllowed}
            onClick={onApplyNeutralPatchRgbSuggestion}
          >
            {t('modals.negativeConversion.applyNeutralPatchRgb')}
          </button>
        </div>
      )}
    </div>
  );
}
