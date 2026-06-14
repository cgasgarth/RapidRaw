import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Clock3, Layers3, ScanSearch, ShieldCheck, XCircle } from 'lucide-react';
import { useCallback, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useModalTransition } from '../../hooks/useModalTransition';
import {
  type SuperResolutionAlignmentMode,
  type SuperResolutionQualityPreference,
  type SuperResolutionUiSettings,
} from '../../schemas/superResolutionUiSchemas';
import { TextColors, TextVariants } from '../../types/typography';
import Button from '../ui/Button';
import Dropdown, { type OptionItem } from '../ui/Dropdown';
import UiText from '../ui/Text';

interface SuperResolutionModalProps {
  isOpen: boolean;
  loadingImageUrl?: string | null;
  onClose: () => void;
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
  onSettingsChange,
  settings,
  sourceCount,
}: SuperResolutionModalProps) {
  const { t } = useTranslation();
  const { isMounted, show } = useModalTransition(isOpen);
  const mouseDownTarget = useRef<EventTarget | null>(null);

  const isSourceCountValid = sourceCount >= 2;
  const isAggressivePreviewOnly = settings.detailPolicy === 'aggressive_preview_only';

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

  const setSetting = useCallback(
    (patch: Partial<SuperResolutionUiSettings>) => {
      onSettingsChange({ ...settings, ...patch });
    },
    [onSettingsChange, settings],
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    mouseDownTarget.current = event.target;
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && mouseDownTarget.current === event.currentTarget) {
      handleClose();
    }
    mouseDownTarget.current = null;
  };

  if (!isMounted) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/40 backdrop-blur-xs transition-opacity duration-300 ease-in-out ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={`bg-surface rounded-xl shadow-2xl p-0 w-full max-w-5xl h-[min(760px,calc(100vh-48px))] overflow-hidden transform transition-all duration-300 ease-out ${
          show ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 -translate-y-4'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="super-resolution-modal-title"
      >
        <div className="flex h-full min-h-0">
          <div className="relative w-[46%] min-w-[320px] bg-[#0d0d0d] border-r border-surface overflow-hidden">
            {loadingImageUrl ? (
              <img
                src={loadingImageUrl}
                alt={t('modals.common.sourcePreviewAlt')}
                className="h-full w-full object-cover opacity-75"
              />
            ) : (
              <div className="h-full w-full bg-bg-primary" />
            )}
            <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/10 to-black/30" />
            <div className="absolute left-6 right-6 bottom-6">
              <UiText
                as="div"
                variant={TextVariants.title}
                className="flex items-center gap-2 mb-3 text-white"
                id="super-resolution-modal-title"
              >
                <ScanSearch className="w-6 h-6 text-accent" />
                <span>{t('modals.superResolution.title')}</span>
              </UiText>
              <UiText className="text-white/80 leading-relaxed">
                {t('modals.superResolution.sourceSummary', { count: sourceCount })}
              </UiText>
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-6 py-5 border-b border-surface/70">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <UiText variant={TextVariants.title}>{t('modals.superResolution.workflowTitle')}</UiText>
                  <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1">
                    {t('modals.superResolution.workflowStatus')}
                  </UiText>
                </div>
                <div className="shrink-0 flex items-center gap-2 rounded-md border border-border-color px-3 py-2 bg-bg-primary">
                  <Clock3 className="w-4 h-4 text-text-secondary" />
                  <UiText variant={TextVariants.small}>{t('modals.superResolution.apiPending')}</UiText>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
              {!isSourceCountValid && (
                <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 flex gap-3">
                  <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <UiText className="leading-relaxed">{t('modals.superResolution.sourceCountBlocked')}</UiText>
                </div>
              )}

              <section>
                <UiText variant={TextVariants.heading} className="mb-3">
                  {t('modals.superResolution.scaleLabel')}
                </UiText>
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

              <section>
                <UiText variant={TextVariants.heading} className="mb-3">
                  {t('modals.superResolution.detailPolicyLabel')}
                </UiText>
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
                      <UiText
                        as="span"
                        variant={TextVariants.small}
                        color={TextColors.secondary}
                        className="block mt-1"
                      >
                        {t(`modals.superResolution.detailPolicy.${detailPolicy}.status`)}
                      </UiText>
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <UiText variant={TextVariants.heading} className="mb-3">
                  {t('modals.superResolution.previewBudgetLabel')}
                </UiText>
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
              </section>

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
                  <StatusLine label={t('modals.superResolution.preflight.sources')} value={String(sourceCount)} />
                  <StatusLine
                    label={t('modals.superResolution.preflight.scale')}
                    value={t('modals.superResolution.scaleValue', { scale: settings.outputScale })}
                  />
                  <StatusLine
                    label={t('modals.superResolution.preflight.alignment')}
                    value={t(`modals.superResolution.alignment.${settings.alignmentMode}`)}
                  />
                  <StatusLine
                    label={t('modals.superResolution.preflight.detail')}
                    value={t(`modals.superResolution.detailPolicy.${settings.detailPolicy}.label`)}
                  />
                  <StatusLine
                    label={t('modals.superResolution.preflight.memory')}
                    value={t('modals.superResolution.preflight.pending')}
                  />
                  <StatusLine
                    label={t('modals.superResolution.preflight.provenance')}
                    value={t('modals.superResolution.preflight.required')}
                  />
                </div>
              </motion.section>

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
            </div>

            <div className="px-6 py-4 border-t border-surface/70 flex items-center justify-end gap-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-md text-text-secondary hover:bg-card-active transition-colors text-sm"
                type="button"
              >
                {t('modals.superResolution.close')}
              </button>
              <Button onClick={() => {}} disabled>
                <Layers3 className="w-4 h-4" />
                {t('modals.superResolution.previewPlan')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatusLineProps {
  label: string;
  value: string;
}

function StatusLine({ label, value }: StatusLineProps) {
  return (
    <div className="min-w-0">
      <UiText as="div" variant={TextVariants.small} color={TextColors.secondary}>
        {label}
      </UiText>
      <UiText as="div" variant={TextVariants.label} className="truncate">
        {value}
      </UiText>
    </div>
  );
}
