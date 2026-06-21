import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Layers3, ScanSearch, ShieldCheck } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import ComputationalMergeReviewPanel from './ComputationalMergeReviewPanel';
import {
  ComputationalSetupModalShell,
  ComputationalSetupOptionSection,
  ComputationalSetupSourceWarning,
  ComputationalSetupStatusLine,
} from './ComputationalSetupModalShell';
import { TextColors, TextVariants } from '../../types/typography';
import Button from '../ui/Button';
import Dropdown, { type OptionItem } from '../ui/Dropdown';
import UiText from '../ui/Text';

import type {
  SuperResolutionAlignmentMode,
  SuperResolutionQualityPreference,
  SuperResolutionUiSettings,
} from '../../schemas/superResolutionUiSchemas';

interface SuperResolutionModalProps {
  isOpen: boolean;
  loadingImageUrl?: string | null;
  onClose: () => void;
  onPreviewPlan: () => void;
  onSettingsChange: (settings: SuperResolutionUiSettings) => void;
  settings: SuperResolutionUiSettings;
  sourceCount: number;
}

const scaleOptions = [1.5, 2, 3, 4] as const;
const previewDimensionOptions = [2400, 4096, 8192] as const;

export default function SuperResolutionModal({
  isOpen,
  loadingImageUrl,
  onClose,
  onPreviewPlan,
  onSettingsChange,
  settings,
  sourceCount,
}: SuperResolutionModalProps) {
  const { t } = useTranslation();

  const isSourceCountValid = sourceCount >= 2;
  const isAggressivePreviewOnly = settings.detailPolicy === 'aggressive_preview_only';
  const outputPixelMultiplier = Number((settings.outputScale * settings.outputScale).toFixed(2));
  const estimatedPreviewMegapixels = Math.round((sourceCount * settings.maxPreviewDimensionPx ** 2) / 1_000_000);

  const alignmentOptions: Array<OptionItem<SuperResolutionAlignmentMode>> = [
    { label: t('modals.superResolution.alignmentAuto'), value: 'auto' },
    { label: t('modals.superResolution.alignmentTranslation'), value: 'translation' },
    { label: t('modals.superResolution.alignmentHomography'), value: 'homography' },
    { label: t('modals.superResolution.alignmentOpticalFlow'), value: 'optical_flow' },
  ];

  const qualityOptions: Array<OptionItem<SuperResolutionQualityPreference>> = [
    { label: t('modals.superResolution.qualityPreview'), value: 'preview' },
    { label: t('modals.superResolution.qualityBalanced'), value: 'balanced' },
    { label: t('modals.superResolution.qualityBest'), value: 'best' },
  ];
  const selectedAlignmentLabel =
    alignmentOptions.find((option) => option.value === settings.alignmentMode)?.label ?? '';
  const selectedQualityLabel =
    qualityOptions.find((option) => option.value === settings.qualityPreference)?.label ?? '';
  const sourceReadinessLabel = `${t('modals.superResolution.sourceSummary', { count: sourceCount })} - ${
    isSourceCountValid ? t('modals.superResolution.preflight.ready') : t('modals.superResolution.preflight.blocked')
  }`;
  const reconstructionReadinessLabel = isSourceCountValid
    ? t('modals.superResolution.preflight.ready')
    : t('modals.superResolution.preflight.blocked');

  const setSetting = useCallback(
    (patch: Partial<SuperResolutionUiSettings>) => {
      onSettingsChange({ ...settings, ...patch });
    },
    [onSettingsChange, settings],
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <ComputationalSetupModalShell
      appServerFamily="super_resolution"
      appServerStatusLabel={t('editor.ai.connection.ready')}
      Icon={ScanSearch}
      isOpen={isOpen}
      loadingImageUrl={loadingImageUrl}
      onClose={handleClose}
      sourcePreviewAlt={t('modals.common.sourcePreviewAlt')}
      sourceSummary={t('modals.superResolution.sourceSummary', { count: sourceCount })}
      title={t('modals.superResolution.title')}
      titleId="super-resolution-modal-title"
      workflowStatus={t('modals.superResolution.workflowStatus')}
      workflowTitle={t('modals.superResolution.workflowTitle')}
      footer={
        <>
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-card-active transition-colors text-sm"
            type="button"
          >
            {t('modals.superResolution.close')}
          </button>
          <Button onClick={onPreviewPlan} disabled={!isSourceCountValid}>
            <Layers3 className="w-4 h-4" />
            {t('modals.superResolution.previewPlan')}
          </Button>
        </>
      }
    >
      {!isSourceCountValid && (
        <ComputationalSetupSourceWarning>
          {t('modals.superResolution.sourceCountBlocked')}
        </ComputationalSetupSourceWarning>
      )}

      <ComputationalSetupOptionSection title={t('modals.superResolution.scaleLabel')}>
        <div
          className="mb-3 grid grid-cols-2 gap-2 rounded-md border border-border-color bg-bg-primary p-3 text-sm lg:grid-cols-4"
          data-estimated-preview-megapixels={estimatedPreviewMegapixels}
          data-testid="sr-output-scale-summary"
        >
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.sources')}
            value={sourceReadinessLabel}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.scale')}
            value={t('modals.superResolution.scaleValue', { scale: settings.outputScale })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.outputPixels')}
            value={t('modals.superResolution.outputPixelMultiplier', { multiplier: outputPixelMultiplier })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.workload')}
            value={t('modals.superResolution.previewWorkloadValue', { value: estimatedPreviewMegapixels })}
          />
        </div>
        <div className="grid grid-cols-4 gap-2">
          {scaleOptions.map((scale) => (
            <button
              key={scale}
              className={`h-11 rounded-md border text-sm font-semibold transition-colors ${
                settings.outputScale === scale
                  ? 'border-accent bg-accent text-button-text'
                  : 'border-border-color bg-bg-primary text-text-primary hover:bg-card-active'
              }`}
              onClick={() => {
                setSetting({ outputScale: scale });
              }}
              type="button"
            >
              {t('modals.superResolution.scaleValue', { scale })}
            </button>
          ))}
        </div>
      </ComputationalSetupOptionSection>

      <section
        className="grid grid-cols-4 gap-2 rounded-md border border-border-color bg-bg-secondary/70 p-2 text-sm"
        data-alignment-mode={settings.alignmentMode}
        data-detail-policy={settings.detailPolicy}
        data-reconstruction-ready={String(isSourceCountValid)}
        data-source-count={sourceCount}
        data-testid="sr-readiness-summary"
      >
        <ComputationalSetupStatusLine
          label={t('modals.superResolution.preflight.sources')}
          value={t('modals.superResolution.sourceSummary', { count: sourceCount })}
        />
        <ComputationalSetupStatusLine
          label={t('modals.superResolution.preflight.alignment')}
          value={selectedAlignmentLabel}
        />
        <ComputationalSetupStatusLine
          label={t('modals.superResolution.preflight.detail')}
          value={t(`modals.superResolution.detailPolicy.${settings.detailPolicy}.label`)}
        />
        <ComputationalSetupStatusLine
          label={t('modals.superResolution.workflowTitle')}
          value={reconstructionReadinessLabel}
        />
      </section>

      <section className="grid grid-cols-2 gap-4">
        <div>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.superResolution.alignmentLabel')}
          </UiText>
          <Dropdown
            options={alignmentOptions}
            value={settings.alignmentMode}
            onChange={(alignmentMode) => {
              setSetting({ alignmentMode });
            }}
          />
        </div>
        <div>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.superResolution.qualityLabel')}
          </UiText>
          <Dropdown
            options={qualityOptions}
            value={settings.qualityPreference}
            onChange={(qualityPreference) => {
              setSetting({ qualityPreference });
            }}
          />
        </div>
      </section>

      <ComputationalSetupOptionSection title={t('modals.superResolution.detailPolicyLabel')}>
        <div className="grid grid-cols-3 gap-2">
          {(['conservative', 'balanced', 'aggressive_preview_only'] as const).map((detailPolicy) => (
            <button
              key={detailPolicy}
              className={`min-h-16 rounded-md border px-3 py-2 text-left transition-colors ${
                settings.detailPolicy === detailPolicy
                  ? 'border-accent bg-accent/15'
                  : 'border-border-color bg-bg-primary hover:bg-card-active'
              }`}
              onClick={() => {
                setSetting({ detailPolicy });
              }}
              type="button"
            >
              <UiText as="span" variant={TextVariants.label}>
                {t(`modals.superResolution.detailPolicy.${detailPolicy}.label`)}
              </UiText>
              <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block mt-1">
                {t(`modals.superResolution.detailPolicy.${detailPolicy}.status`)}
              </UiText>
            </button>
          ))}
        </div>
      </ComputationalSetupOptionSection>

      <ComputationalSetupOptionSection title={t('modals.superResolution.previewBudgetLabel')}>
        <div className="grid grid-cols-3 gap-2">
          {previewDimensionOptions.map((maxPreviewDimensionPx) => (
            <button
              key={maxPreviewDimensionPx}
              className={`h-10 rounded-md border text-sm transition-colors ${
                settings.maxPreviewDimensionPx === maxPreviewDimensionPx
                  ? 'border-accent bg-accent/15 text-text-primary'
                  : 'border-border-color bg-bg-primary text-text-secondary hover:bg-card-active'
              }`}
              onClick={() => {
                setSetting({ maxPreviewDimensionPx });
              }}
              type="button"
            >
              {t('modals.superResolution.previewBudgetValue', { value: maxPreviewDimensionPx })}
            </button>
          ))}
        </div>
      </ComputationalSetupOptionSection>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-md border border-border-color bg-bg-primary p-4"
      >
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-5 h-5 text-accent" />
          <UiText variant={TextVariants.heading}>{t('modals.superResolution.preflightTitle')}</UiText>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.sources')}
            value={String(sourceCount)}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.scale')}
            value={t('modals.superResolution.scaleValue', { scale: settings.outputScale })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.outputPixels')}
            value={t('modals.superResolution.outputPixelMultiplier', { multiplier: outputPixelMultiplier })}
          />
          <ComputationalSetupStatusLine label={t('modals.superResolution.qualityLabel')} value={selectedQualityLabel} />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.alignment')}
            value={t(`modals.superResolution.alignment.${settings.alignmentMode}`)}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.detail')}
            value={t(`modals.superResolution.detailPolicy.${settings.detailPolicy}.label`)}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.workload')}
            value={t('modals.superResolution.previewWorkloadValue', { value: estimatedPreviewMegapixels })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.superResolution.preflight.provenance')}
            value={t('modals.superResolution.preflight.required')}
          />
        </div>
      </motion.section>

      <ComputationalMergeReviewPanel
        title={t('modals.superResolution.review.title')}
        proofStatus={t('modals.superResolution.review.proofStatus')}
        limitation={t('modals.superResolution.review.limitation')}
        testId="sr-review-diagnostics"
        items={[
          {
            label: t('modals.superResolution.review.registration'),
            status: 'ready',
            value: t('modals.superResolution.review.runtimeBridge'),
          },
          {
            label: t('modals.superResolution.review.detailGain'),
            status: 'review',
            value: t('modals.superResolution.review.privateRawPending'),
          },
          {
            label: t('modals.superResolution.review.ringing'),
            status: 'pending',
            value: t('modals.superResolution.review.uiE2ePending'),
          },
        ]}
        sections={[
          {
            title: t('modals.superResolution.preflightTitle'),
            rows: [
              {
                label: t('modals.superResolution.preflight.sources'),
                value: sourceReadinessLabel,
              },
              {
                label: t('modals.superResolution.preflight.scale'),
                value: t('modals.superResolution.scaleValue', { scale: settings.outputScale }),
              },
              {
                label: t('modals.superResolution.preflight.outputPixels'),
                value: t('modals.superResolution.outputPixelMultiplier', { multiplier: outputPixelMultiplier }),
              },
              {
                label: t('modals.superResolution.preflight.workload'),
                value: t('modals.superResolution.previewWorkloadValue', { value: estimatedPreviewMegapixels }),
              },
              {
                label: t('modals.superResolution.preflight.alignment'),
                value: t(`modals.superResolution.alignment.${settings.alignmentMode}`),
              },
              {
                label: t('modals.superResolution.qualityLabel'),
                value: selectedQualityLabel,
              },
            ],
          },
          {
            title: t('modals.superResolution.review.title'),
            rows: [
              {
                label: t('modals.superResolution.preflight.detail'),
                value: t(`modals.superResolution.detailPolicy.${settings.detailPolicy}.label`),
              },
              {
                label: t('modals.superResolution.review.detailGain'),
                value: t('modals.superResolution.review.privateRawPending'),
              },
            ],
          },
        ]}
      />

      {isAggressivePreviewOnly && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
          <UiText className="leading-relaxed">{t('modals.superResolution.aggressiveNotice')}</UiText>
        </div>
      )}

      <div className="rounded-md border border-border-color bg-bg-primary px-4 py-3 flex gap-3">
        <CheckCircle2 className="w-5 h-5 text-text-secondary shrink-0 mt-0.5" />
        <UiText className="leading-relaxed">{t('modals.superResolution.planDependency')}</UiText>
      </div>
    </ComputationalSetupModalShell>
  );
}
