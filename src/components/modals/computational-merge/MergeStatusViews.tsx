import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle, Loader2, RefreshCw, Save, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TextColors, TextVariants } from '../../../types/typography';
import { getDisplayFileName } from '../../../utils/displayFilePath';
import Button from '../../ui/primitives/Button';
import UiText from '../../ui/primitives/Text';

interface MergeErrorStateProps {
  error: string;
  title: string;
}

export function MergeErrorState({ error, title }: MergeErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 h-[460px]">
      <div className="flex items-center justify-center mb-6">
        <XCircle className="w-12 h-12 text-red-500" />
      </div>
      <UiText variant={TextVariants.title} className="mb-2 text-center">
        {title}
      </UiText>
      <UiText className="text-center p-4 rounded-lg bg-bg-primary max-w-md mt-2 leading-relaxed">{error}</UiText>
    </div>
  );
}

interface MergeResultPreviewProps {
  alt: string;
  children?: ReactNode;
  imageBase64: string;
  savedPath: string | null;
  savedSuccessLabel: string;
}

export function MergeResultPreview({
  alt,
  children,
  imageBase64,
  savedPath,
  savedSuccessLabel,
}: MergeResultPreviewProps) {
  const { t } = useTranslation();
  const savedOutputName = savedPath ? getDisplayFileName(savedPath) : '';

  return (
    <div className="w-full">
      <div className="w-full max-h-[500px] bg-[#111] rounded-lg overflow-hidden border border-surface flex items-center justify-center">
        <img src={imageBase64} alt={alt} className="w-full h-full object-contain max-h-[500px]" />
      </div>
      {savedPath && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <UiText
            as="div"
            variant={TextVariants.heading}
            color={TextColors.success}
            className="flex items-center justify-center gap-2 mt-4"
          >
            <CheckCircle aria-hidden="true" className="w-5 h-5" />
            <span>{savedSuccessLabel}</span>
          </UiText>
          <UiText
            as="div"
            variant={TextVariants.small}
            color={TextColors.secondary}
            className="mx-auto mt-2 block max-w-full truncate text-center font-mono"
            data-saved-output-name={savedOutputName}
            data-testid="merge-saved-output-detail"
            title={savedPath}
          >
            {t('modals.common.savedOutputLabel', { name: savedOutputName })}
            <span className="sr-only">{t('modals.common.savedOutputFullPath', { path: savedPath })}</span>
          </UiText>
          {children}
        </motion.div>
      )}
    </div>
  );
}

interface MergeProcessingStateProps {
  children?: ReactNode;
  initialLabel: string;
  loadingImageUrl?: string | null | undefined;
  progressMessage: string | null;
  sourcePreviewAlt: string;
  speedNotice: string;
  title: string;
}

export function MergeProcessingState({
  children,
  initialLabel,
  loadingImageUrl,
  progressMessage,
  sourcePreviewAlt,
  speedNotice,
  title,
}: MergeProcessingStateProps) {
  return (
    <div className="flex h-[460px] overflow-hidden rounded-lg border border-surface">
      <div className="w-2/5 relative overflow-hidden shrink-0 bg-[#0a0a0a] flex items-center justify-center">
        {loadingImageUrl ? (
          <img src={loadingImageUrl} alt={sourcePreviewAlt} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-surface/50" />
        )}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-12 bg-bg-primary">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="flex flex-col items-center w-full"
        >
          <UiText variant={TextVariants.title} className="mb-2 text-center">
            {title}
          </UiText>
          <UiText className="text-center font-mono h-6 flex justify-center items-center">
            {progressMessage || initialLabel}
          </UiText>

          <div className="mt-8 w-64 relative">
            <div className="h-1 bg-surface rounded-full overflow-hidden relative w-full shadow-xs">
              <motion.div
                className="absolute inset-y-0 w-[80%] bg-linear-to-r from-transparent via-accent to-transparent mix-blend-screen"
                style={{ filter: 'blur(3px)' }}
                animate={{ x: ['-150%', '150%'] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: [0.4, 0, 0.2, 1] }}
              />
              <motion.div
                className="absolute inset-y-0 w-[40%] bg-linear-to-r from-transparent via-white/90 to-transparent"
                style={{ filter: 'blur(1px)' }}
                animate={{ x: ['-250%', '250%'] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: [0.4, 0, 0.2, 1] }}
              />
            </div>
          </div>

          <UiText variant={TextVariants.small} className="mt-6 text-center max-w-xs opacity-60">
            {speedNotice}
          </UiText>
          {children}
        </motion.div>
      </div>
    </div>
  );
}

interface MergeFooterLabels {
  cancel: string;
  close: string;
  openInEditor: string;
  retry: string;
  save: string;
  start: string;
}

interface MergeFooterActionsProps {
  error: string | null;
  finalImageBase64: string | null;
  isProcessing: boolean;
  isSaving: boolean;
  isSourceCountValid: boolean;
  labels: MergeFooterLabels;
  onClose: () => void;
  onOpen: () => void;
  onRun: () => void;
  onSave: () => void;
  savedPath: string | null;
  StartIcon: LucideIcon;
}

export function MergeFooterActions({
  error,
  finalImageBase64,
  isProcessing,
  isSaving,
  isSourceCountValid,
  labels,
  onClose,
  onOpen,
  onRun,
  onSave,
  savedPath,
  StartIcon,
}: MergeFooterActionsProps) {
  if (error) {
    return (
      <Button onClick={onClose} className="w-full">
        {labels.close}
      </Button>
    );
  }

  if (savedPath) {
    return (
      <>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-md text-text-secondary hover:bg-card-active transition-colors"
        >
          {labels.close}
        </button>
        <Button data-open-target-path={savedPath} data-testid="merge-open-saved-output" onClick={onOpen}>
          {labels.openInEditor}
        </Button>
      </>
    );
  }

  const disabled = isProcessing || isSaving;
  const isStartBlocked = !finalImageBase64 && !isSourceCountValid;
  const isStartDisabled = isProcessing || isStartBlocked;

  return (
    <div className={`w-full flex items-center justify-end gap-2 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <button
        onClick={onClose}
        className="px-4 py-2 rounded-md text-text-secondary hover:bg-card-active transition-colors text-sm"
      >
        {finalImageBase64 ? labels.close : labels.cancel}
      </button>

      <Button
        className="disabled:bg-bg-secondary disabled:text-text-tertiary disabled:ring-1 disabled:ring-border-color"
        data-start-blocked={String(isStartBlocked)}
        data-testid="merge-start-action"
        onClick={onRun}
        disabled={isStartDisabled}
        variant={finalImageBase64 ? 'secondary' : 'primary'}
      >
        {isProcessing ? (
          <Loader2 className="animate-spin mr-2" size={16} />
        ) : finalImageBase64 ? (
          <RefreshCw className="mr-2" size={16} />
        ) : (
          <StartIcon className="mr-2" size={16} />
        )}
        {finalImageBase64 ? labels.retry : labels.start}
      </Button>

      {finalImageBase64 && (
        <Button onClick={onSave} disabled={isSaving || isProcessing}>
          {isSaving ? <Loader2 className="animate-spin mr-2" size={16} /> : <Save className="mr-2" size={16} />}
          {labels.save}
        </Button>
      )}
    </div>
  );
}
