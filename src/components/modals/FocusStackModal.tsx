import { motion } from 'framer-motion';
import { Aperture, CheckCircle2, Clock3, Layers3, ShieldCheck, XCircle } from 'lucide-react';
import { useCallback, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useModalTransition } from '../../hooks/useModalTransition';
import {
  type FocusStackAlignmentMode,
  type FocusStackBlendMethod,
  type FocusStackQualityPreference,
  type FocusStackRetouchPolicy,
  type FocusStackUiSettings,
} from '../../schemas/focusStackUiSchemas';
import { TextColors, TextVariants } from '../../types/typography';
import Button from '../ui/Button';
import Dropdown, { type OptionItem } from '../ui/Dropdown';
import UiText from '../ui/Text';

interface FocusStackModalProps {
  isOpen: boolean;
  loadingImageUrl?: string | null;
  onClose: () => void;
  onSettingsChange: (settings: FocusStackUiSettings) => void;
  settings: FocusStackUiSettings;
  sourceCount: number;
}

const previewDimensionOptions = [2400, 4096, 8192] as const;

export default function FocusStackModal({
  isOpen,
  loadingImageUrl,
  onClose,
  onSettingsChange,
  settings,
  sourceCount,
}: FocusStackModalProps) {
  const { t } = useTranslation();
  const { isMounted, show } = useModalTransition(isOpen);
  const mouseDownTarget = useRef<EventTarget | null>(null);

  const isSourceCountValid = sourceCount >= 2;

  const alignmentOptions: Array<OptionItem<FocusStackAlignmentMode>> = [
    { label: t('modals.focusStack.alignmentAuto'), value: 'auto' },
    { label: t('modals.focusStack.alignmentTranslation'), value: 'translation' },
    { label: t('modals.focusStack.alignmentHomography'), value: 'homography' },
    { label: t('modals.focusStack.alignmentOpticalFlow'), value: 'optical_flow' },
  ];

  const blendOptions: Array<OptionItem<FocusStackBlendMethod>> = [
    { label: t('modals.focusStack.blendDepthMap'), value: 'depth_map' },
    { label: t('modals.focusStack.blendLaplacianPyramid'), value: 'laplacian_pyramid' },
    { label: t('modals.focusStack.blendWeightedSharpness'), value: 'weighted_sharpness' },
  ];

  const qualityOptions: Array<OptionItem<FocusStackQualityPreference>> = [
    { label: t('modals.focusStack.qualityPreview'), value: 'preview' },
    { label: t('modals.focusStack.qualityBalanced'), value: 'balanced' },
    { label: t('modals.focusStack.qualityBest'), value: 'best' },
  ];

  const setSetting = useCallback(
    (patch: Partial<FocusStackUiSettings>) => {
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
        aria-labelledby="focus-stack-modal-title"
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
                id="focus-stack-modal-title"
              >
                <Aperture className="w-6 h-6 text-accent" />
                <span>{t('modals.focusStack.title')}</span>
              </UiText>
              <UiText className="text-white/80 leading-relaxed">
                {t('modals.focusStack.sourceSummary', { count: sourceCount })}
              </UiText>
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-6 py-5 border-b border-surface/70">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <UiText variant={TextVariants.title}>{t('modals.focusStack.workflowTitle')}</UiText>
                  <UiText variant={TextVariants.small} color={TextColors.secondary} className="mt-1">
                    {t('modals.focusStack.workflowStatus')}
                  </UiText>
                </div>
                <div className="shrink-0 flex items-center gap-2 rounded-md border border-border-color px-3 py-2 bg-bg-primary">
                  <Clock3 className="w-4 h-4 text-text-secondary" />
                  <UiText variant={TextVariants.small}>{t('modals.focusStack.apiPending')}</UiText>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
              {!isSourceCountValid && (
                <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 flex gap-3">
                  <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <UiText className="leading-relaxed">{t('modals.focusStack.sourceCountBlocked')}</UiText>
                </div>
              )}

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
                    {t('modals.focusStack.blendMethodLabel')}
                  </UiText>
                  <Dropdown
                    options={blendOptions}
                    value={settings.blendMethod}
                    onChange={(blendMethod) => {
                      setSetting({ blendMethod });
                    }}
                  />
                </div>
              </section>

              <section className="grid grid-cols-2 gap-4">
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
                <div>
                  <UiText variant={TextVariants.heading} className="mb-2">
                    {t('modals.focusStack.previewBudgetLabel')}
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
                        {t('modals.focusStack.previewBudgetValue', { value: maxPreviewDimensionPx })}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section>
                <UiText variant={TextVariants.heading} className="mb-3">
                  {t('modals.focusStack.retouchPolicyLabel')}
                </UiText>
                <div className="grid grid-cols-2 gap-2">
                  {(['generate_retouch_layer', 'none'] as const satisfies ReadonlyArray<FocusStackRetouchPolicy>).map(
                    (retouchPolicy) => (
                      <button
                        key={retouchPolicy}
                        className={`min-h-16 rounded-md border px-3 py-2 text-left transition-colors ${
                          settings.retouchPolicy === retouchPolicy
                            ? 'border-accent bg-accent/15'
                            : 'border-border-color bg-bg-primary hover:bg-card-active'
                        }`}
                        onClick={() => {
                          setSetting({ retouchPolicy });
                        }}
                        type="button"
                      >
                        <UiText as="span" variant={TextVariants.label}>
                          {t(`modals.focusStack.retouchPolicy.${retouchPolicy}.label`)}
                        </UiText>
                        <UiText
                          as="span"
                          variant={TextVariants.small}
                          color={TextColors.secondary}
                          className="block mt-1"
                        >
                          {t(`modals.focusStack.retouchPolicy.${retouchPolicy}.status`)}
                        </UiText>
                      </button>
                    ),
                  )}
                </div>
              </section>

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
                  <StatusLine label={t('modals.focusStack.preflight.sources')} value={String(sourceCount)} />
                  <StatusLine
                    label={t('modals.focusStack.preflight.alignment')}
                    value={t(`modals.focusStack.alignment.${settings.alignmentMode}`)}
                  />
                  <StatusLine
                    label={t('modals.focusStack.preflight.blend')}
                    value={t(`modals.focusStack.blendMethod.${settings.blendMethod}`)}
                  />
                  <StatusLine
                    label={t('modals.focusStack.preflight.retouch')}
                    value={t(`modals.focusStack.retouchPolicy.${settings.retouchPolicy}.label`)}
                  />
                  <StatusLine
                    label={t('modals.focusStack.preflight.depth')}
                    value={t('modals.focusStack.preflight.pending')}
                  />
                  <StatusLine
                    label={t('modals.focusStack.preflight.provenance')}
                    value={t('modals.focusStack.preflight.required')}
                  />
                </div>
              </motion.section>

              <div className="rounded-md border border-border-color bg-bg-primary px-4 py-3 flex gap-3">
                <CheckCircle2 className="w-5 h-5 text-text-secondary shrink-0 mt-0.5" />
                <UiText className="leading-relaxed">{t('modals.focusStack.planDependency')}</UiText>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-surface/70 flex items-center justify-end gap-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-md text-text-secondary hover:bg-card-active transition-colors text-sm"
                type="button"
              >
                {t('modals.focusStack.close')}
              </button>
              <Button onClick={() => {}} disabled>
                <Layers3 className="w-4 h-4" />
                {t('modals.focusStack.previewPlan')}
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
