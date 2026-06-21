import { motion } from 'framer-motion';
import { AlertTriangle, Aperture, CheckCircle2, Layers3, ShieldCheck } from 'lucide-react';
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
  FocusStackAlignmentMode,
  FocusStackQualityPreference,
  FocusStackUiSettings,
} from '../../schemas/focusStackUiSchemas';

interface FocusStackModalProps {
  isOpen: boolean;
  loadingImageUrl?: string | null;
  onClose: () => void;
  onPreviewPlan: () => void;
  onSettingsChange: (settings: FocusStackUiSettings) => void;
  settings: FocusStackUiSettings;
  sourceCount: number;
}

const previewDimensionOptions = [2400, 4096, 8192] as const;

export default function FocusStackModal({
  isOpen,
  loadingImageUrl,
  onClose,
  onPreviewPlan,
  onSettingsChange,
  settings,
  sourceCount,
}: FocusStackModalProps) {
  const { t } = useTranslation();

  const isSourceCountValid = sourceCount >= 2;
  const isDepthMapPreviewOnly = settings.blendMethod === 'depth_map';

  const alignmentOptions: Array<OptionItem<FocusStackAlignmentMode>> = [
    { label: t('modals.focusStack.alignmentAuto'), value: 'auto' },
    { label: t('modals.focusStack.alignmentTranslation'), value: 'translation' },
    { label: t('modals.focusStack.alignmentHomography'), value: 'homography' },
    { label: t('modals.focusStack.alignmentNone'), value: 'none' },
  ];

  const qualityOptions: Array<OptionItem<FocusStackQualityPreference>> = [
    { label: t('modals.focusStack.qualityPreview'), value: 'preview' },
    { label: t('modals.focusStack.qualityBalanced'), value: 'balanced' },
    { label: t('modals.focusStack.qualityBest'), value: 'best' },
  ];
  const selectedAlignmentLabel =
    alignmentOptions.find((option) => option.value === settings.alignmentMode)?.label ?? '';
  const selectedQualityLabel =
    qualityOptions.find((option) => option.value === settings.qualityPreference)?.label ?? '';
  const estimatedPreviewMegapixels = Math.round((sourceCount * settings.maxPreviewDimensionPx ** 2) / 1_000_000);
  const sourceReadinessLabel = `${t('modals.focusStack.sourceSummary', { count: sourceCount })} - ${
    isSourceCountValid ? t('modals.focusStack.preflight.ready') : t('modals.focusStack.preflight.blocked')
  }`;
  const stackReadinessLabel = isSourceCountValid
    ? t('modals.focusStack.preflight.ready')
    : t('modals.focusStack.preflight.blocked');

  const setSetting = useCallback(
    (patch: Partial<FocusStackUiSettings>) => {
      onSettingsChange({ ...settings, ...patch });
    },
    [onSettingsChange, settings],
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <ComputationalSetupModalShell
      appServerFamily="focus_stack"
      appServerStatusLabel={t('editor.ai.connection.ready')}
      Icon={Aperture}
      isOpen={isOpen}
      loadingImageUrl={loadingImageUrl}
      onClose={handleClose}
      sourcePreviewAlt={t('modals.common.sourcePreviewAlt')}
      sourceSummary={t('modals.focusStack.sourceSummary', { count: sourceCount })}
      title={t('modals.focusStack.title')}
      titleId="focus-stack-modal-title"
      workflowStatus={t('modals.focusStack.workflowStatus')}
      workflowTitle={t('modals.focusStack.workflowTitle')}
      footer={
        <>
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-md text-text-secondary hover:bg-card-active transition-colors text-sm"
            type="button"
          >
            {t('modals.focusStack.close')}
          </button>
          <Button onClick={onPreviewPlan} disabled={!isSourceCountValid}>
            <Layers3 className="w-4 h-4" />
            {t('modals.focusStack.previewPlan')}
          </Button>
        </>
      }
    >
      {!isSourceCountValid && (
        <ComputationalSetupSourceWarning>{t('modals.focusStack.sourceCountBlocked')}</ComputationalSetupSourceWarning>
      )}

      <section
        className="grid grid-cols-2 gap-2 rounded-md border border-border-color bg-bg-primary p-3 text-sm lg:grid-cols-5"
        data-estimated-preview-megapixels={estimatedPreviewMegapixels}
        data-preview-source-count={sourceCount}
        data-testid="focus-stack-setup-summary"
      >
        <ComputationalSetupStatusLine label={t('modals.focusStack.preflight.sources')} value={sourceReadinessLabel} />
        <ComputationalSetupStatusLine label={t('modals.focusStack.qualityLabel')} value={selectedQualityLabel} />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.workload')}
          value={t('modals.focusStack.previewWorkloadValue', { value: estimatedPreviewMegapixels })}
        />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.blend')}
          value={t(`modals.focusStack.blendMethod.${settings.blendMethod}.label`)}
        />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.retouch')}
          value={t(`modals.focusStack.retouchPolicy.${settings.retouchLayerPolicy}.label`)}
        />
      </section>
      <section
        className="grid grid-cols-4 gap-2 rounded-md border border-border-color bg-bg-secondary/70 p-2 text-sm"
        data-alignment-mode={settings.alignmentMode}
        data-blend-method={settings.blendMethod}
        data-source-count={sourceCount}
        data-stack-ready={String(isSourceCountValid)}
        data-testid="focus-stack-readiness-summary"
      >
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.sources')}
          value={t('modals.focusStack.sourceSummary', { count: sourceCount })}
        />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.alignment')}
          value={selectedAlignmentLabel}
        />
        <ComputationalSetupStatusLine
          label={t('modals.focusStack.preflight.blend')}
          value={t(`modals.focusStack.blendMethod.${settings.blendMethod}.label`)}
        />
        <ComputationalSetupStatusLine label={t('modals.focusStack.workflowTitle')} value={stackReadinessLabel} />
      </section>

      <section className="grid grid-cols-2 gap-4">
        <div>
          <UiText variant={TextVariants.heading} className="mb-2">
            {t('modals.focusStack.alignmentLabel')}
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
            {t('modals.focusStack.qualityLabel')}
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

      <ComputationalSetupOptionSection title={t('modals.focusStack.blendLabel')}>
        <div className="grid grid-cols-3 gap-2">
          {(['laplacian_pyramid', 'weighted_sharpness', 'depth_map'] as const).map((blendMethod) => (
            <button
              key={blendMethod}
              className={`min-h-16 rounded-md border px-3 py-2 text-left transition-colors ${
                settings.blendMethod === blendMethod
                  ? 'border-accent bg-accent/15'
                  : 'border-border-color bg-bg-primary hover:bg-card-active'
              }`}
              onClick={() => {
                setSetting({ blendMethod });
              }}
              type="button"
            >
              <UiText as="span" variant={TextVariants.label}>
                {t(`modals.focusStack.blendMethod.${blendMethod}.label`)}
              </UiText>
              <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block mt-1">
                {t(`modals.focusStack.blendMethod.${blendMethod}.status`)}
              </UiText>
            </button>
          ))}
        </div>
      </ComputationalSetupOptionSection>

      <ComputationalSetupOptionSection title={t('modals.focusStack.retouchLabel')}>
        <div className="grid grid-cols-2 gap-2">
          {(['generate_retouch_layer', 'none'] as const).map((retouchLayerPolicy) => (
            <button
              key={retouchLayerPolicy}
              className={`min-h-16 rounded-md border px-3 py-2 text-left transition-colors ${
                settings.retouchLayerPolicy === retouchLayerPolicy
                  ? 'border-accent bg-accent/15'
                  : 'border-border-color bg-bg-primary hover:bg-card-active'
              }`}
              onClick={() => {
                setSetting({ retouchLayerPolicy });
              }}
              type="button"
            >
              <UiText as="span" variant={TextVariants.label}>
                {t(`modals.focusStack.retouchPolicy.${retouchLayerPolicy}.label`)}
              </UiText>
              <UiText as="span" variant={TextVariants.small} color={TextColors.secondary} className="block mt-1">
                {t(`modals.focusStack.retouchPolicy.${retouchLayerPolicy}.status`)}
              </UiText>
            </button>
          ))}
        </div>
      </ComputationalSetupOptionSection>

      <ComputationalSetupOptionSection title={t('modals.focusStack.previewBudgetLabel')}>
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
              {t('modals.focusStack.previewBudgetValue', { value: maxPreviewDimensionPx })}
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
          <UiText variant={TextVariants.heading}>{t('modals.focusStack.preflightTitle')}</UiText>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <ComputationalSetupStatusLine label={t('modals.focusStack.preflight.sources')} value={sourceReadinessLabel} />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.preflight.alignment')}
            value={t(`modals.focusStack.alignment.${settings.alignmentMode}`)}
          />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.preflight.blend')}
            value={t(`modals.focusStack.blendMethod.${settings.blendMethod}.label`)}
          />
          <ComputationalSetupStatusLine label={t('modals.focusStack.qualityLabel')} value={selectedQualityLabel} />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.preflight.retouch')}
            value={t(`modals.focusStack.retouchPolicy.${settings.retouchLayerPolicy}.label`)}
          />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.preflight.previewBudget')}
            value={t('modals.focusStack.previewBudgetValue', { value: settings.maxPreviewDimensionPx })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.preflight.workload')}
            value={t('modals.focusStack.previewWorkloadValue', { value: estimatedPreviewMegapixels })}
          />
          <ComputationalSetupStatusLine
            label={t('modals.focusStack.preflight.provenance')}
            value={t('modals.focusStack.preflight.required')}
          />
        </div>
      </motion.section>

      <ComputationalMergeReviewPanel
        title={t('modals.focusStack.review.title')}
        proofStatus={t('modals.focusStack.review.proofStatus')}
        limitation={t('modals.focusStack.review.limitation')}
        testId="focus-review-diagnostics"
        items={[
          {
            label: t('modals.focusStack.review.sharpnessMap'),
            status: 'ready',
            value: t('modals.focusStack.review.runtimeBridge'),
          },
          {
            label: t('modals.focusStack.review.transitions'),
            status: 'review',
            value: t('modals.focusStack.review.privateRawPending'),
          },
          {
            label: t('modals.focusStack.review.retouchLayer'),
            status: 'pending',
            value: t('modals.focusStack.review.uiE2ePending'),
          },
        ]}
        sections={[
          {
            title: t('modals.focusStack.preflightTitle'),
            rows: [
              {
                label: t('modals.focusStack.preflight.sources'),
                value: sourceReadinessLabel,
              },
              {
                label: t('modals.focusStack.preflight.alignment'),
                value: t(`modals.focusStack.alignment.${settings.alignmentMode}`),
              },
              {
                label: t('modals.focusStack.qualityLabel'),
                value: selectedQualityLabel,
              },
              {
                label: t('modals.focusStack.preflight.previewBudget'),
                value: t('modals.focusStack.previewBudgetValue', { value: settings.maxPreviewDimensionPx }),
              },
              {
                label: t('modals.focusStack.preflight.workload'),
                value: t('modals.focusStack.previewWorkloadValue', { value: estimatedPreviewMegapixels }),
              },
              {
                label: t('modals.focusStack.preflight.blend'),
                value: t(`modals.focusStack.blendMethod.${settings.blendMethod}.label`),
              },
            ],
          },
          {
            title: t('modals.focusStack.review.title'),
            rows: [
              {
                label: t('modals.focusStack.preflight.retouch'),
                value: t(`modals.focusStack.retouchPolicy.${settings.retouchLayerPolicy}.label`),
              },
              {
                label: t('modals.focusStack.review.transitions'),
                value: t('modals.focusStack.review.privateRawPending'),
              },
            ],
          },
        ]}
      />

      {isDepthMapPreviewOnly && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
          <UiText className="leading-relaxed">{t('modals.focusStack.depthMapNotice')}</UiText>
        </div>
      )}

      <div className="rounded-md border border-border-color bg-bg-primary px-4 py-3 flex gap-3">
        <CheckCircle2 className="w-5 h-5 text-text-secondary shrink-0 mt-0.5" />
        <UiText className="leading-relaxed">{t('modals.focusStack.planDependency')}</UiText>
      </div>
    </ComputationalSetupModalShell>
  );
}
