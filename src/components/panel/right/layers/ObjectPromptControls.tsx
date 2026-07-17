import cx from 'clsx';
import type { TFunction } from 'i18next';
import { Loader2 } from 'lucide-react';
import { TextColors, TextVariants } from '../../../../types/typography';

import type {
  ObjectMaskProposalCommandInput,
  ObjectMaskProposalReplayReceipt,
  ObjectPromptCanvasState,
  ObjectPromptMode,
} from '../../../../utils/mask/objectMaskPromptCanvas';
import { editorChromeStatusChipClassName } from '../../../ui/editorChromeTokens';
import { professionalInspectorDensityTokens } from '../../../ui/inspectorTokens';
import UiText from '../../../ui/primitives/Text';

interface ObjectPromptControlsProps {
  commandInput: ObjectMaskProposalCommandInput | null;
  isGenerating: boolean;
  hasPendingProposal?: boolean;
  onAccept?: () => void;
  onCancelProposal?: () => void;
  onClear: () => void;
  onGenerate: () => void;
  onModeChange: (mode: ObjectPromptMode) => void;
  providerStatusText: string;
  replayReceipt: ObjectMaskProposalReplayReceipt | null;
  selectedImagePath: string | undefined;
  status?: 'empty' | 'pending' | 'review' | 'accepted' | 'cancelled' | 'error';
  error?: string | null;
  state: ObjectPromptCanvasState;
  t: TFunction;
}

type ObjectPromptModeLabelKey =
  | 'editor.masks.objectPrompt.foreground'
  | 'editor.masks.objectPrompt.background'
  | 'editor.masks.objectPrompt.box';

const OBJECT_PROMPT_MODE_ACTIONS: Array<{ labelKey: ObjectPromptModeLabelKey; mode: ObjectPromptMode }> = [
  { labelKey: 'editor.masks.objectPrompt.foreground', mode: 'foreground_point' },
  { labelKey: 'editor.masks.objectPrompt.background', mode: 'background_point' },
  { labelKey: 'editor.masks.objectPrompt.box', mode: 'box' },
];

function ObjectPromptStatusMessage({
  error,
  status,
  t,
}: {
  error: string | null;
  status: NonNullable<ObjectPromptControlsProps['status']>;
  t: TFunction;
}) {
  const message = {
    accepted: t('editor.masks.objectPrompt.status.accepted', { defaultValue: 'Mask applied' }),
    cancelled: t('editor.masks.objectPrompt.status.cancelled', { defaultValue: 'Selection cancelled' }),
    empty: t('editor.masks.objectPrompt.status.empty', { defaultValue: 'Add a point or box to begin' }),
    error: error ?? t('editor.masks.objectPrompt.status.error', { defaultValue: 'Selection failed' }),
    pending: t('editor.masks.objectPrompt.status.pending', { defaultValue: 'Finding object…' }),
    review: t('editor.masks.objectPrompt.status.review', { defaultValue: 'Review selection' }),
  }[status];
  return (
    <div
      className="rounded border border-editor-border bg-editor-panel-well px-2 py-1 text-[11px] text-text-secondary"
      data-testid="object-prompt-state"
      data-status={status}
      role="status"
    >
      {message}
    </div>
  );
}

function ObjectPromptReviewActions({
  hasPendingProposal,
  onAccept,
  onCancelProposal,
  t,
}: Pick<ObjectPromptControlsProps, 'hasPendingProposal' | 'onAccept' | 'onCancelProposal' | 't'>) {
  if (!hasPendingProposal) return null;
  return (
    <div className="grid grid-cols-2 gap-1" data-testid="object-prompt-review-actions">
      <button
        className="min-h-7 rounded bg-editor-primary-active px-2 py-1 text-xs font-medium text-editor-primary-active-text"
        data-testid="object-prompt-apply"
        onClick={onAccept}
        type="button"
      >
        {t('editor.masks.objectPrompt.apply', { defaultValue: 'Apply mask' })}
      </button>
      <button
        className="min-h-7 rounded bg-editor-panel px-2 py-1 text-xs font-medium text-text-secondary"
        data-testid="object-prompt-cancel"
        onClick={onCancelProposal}
        type="button"
      >
        {t('editor.masks.objectPrompt.cancel', { defaultValue: 'Cancel' })}
      </button>
    </div>
  );
}

export function ObjectPromptControls({
  commandInput,
  error = null,
  hasPendingProposal = false,
  isGenerating,
  onAccept = () => undefined,
  onCancelProposal = () => undefined,
  onClear,
  onGenerate,
  onModeChange,
  providerStatusText,
  replayReceipt,
  selectedImagePath,
  status = 'empty',
  state,
  t,
}: ObjectPromptControlsProps) {
  return (
    <div
      className={`${professionalInspectorDensityTokens.card.nestedPanel} space-y-2`}
      data-object-prompt-box-ready={String(state.boxPrompt !== null)}
      data-object-prompt-mode={state.mode}
      data-object-prompt-point-count={state.pointPrompts.length}
      data-object-prompt-status={status}
      data-testid="object-prompt-controls"
    >
      <ObjectPromptStatusMessage error={error} status={status} t={t} />
      <div className="grid grid-cols-4 gap-1">
        {OBJECT_PROMPT_MODE_ACTIONS.map((action) => (
          <button
            className={cx(
              'min-w-0 rounded px-1.5 py-1 text-[11px] font-medium leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring',
              state.mode === action.mode
                ? 'bg-editor-primary-active text-editor-primary-active-text'
                : 'bg-editor-panel text-text-secondary hover:bg-editor-panel-raised hover:text-text-primary',
            )}
            data-testid={`object-prompt-mode-${action.mode}`}
            key={action.mode}
            onClick={() => {
              onModeChange(action.mode);
            }}
            type="button"
          >
            <span className="block truncate">{t(action.labelKey)}</span>
          </button>
        ))}
        <button
          className="min-w-0 rounded bg-editor-panel px-1.5 py-1 text-[11px] font-medium leading-4 text-text-secondary transition-colors hover:bg-editor-panel-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
          data-testid="object-prompt-clear"
          onClick={onClear}
          type="button"
        >
          <span className="block truncate">{t('editor.masks.objectPrompt.clear')}</span>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1 text-[11px] text-text-tertiary">
        <span
          className={editorChromeStatusChipClassName(state.pointPrompts.length > 0 ? 'success' : 'neutral')}
          data-testid="object-prompt-point-summary"
        >
          {t('editor.masks.objectPrompt.points', { count: state.pointPrompts.length })}
        </span>
        <span
          className={editorChromeStatusChipClassName(state.boxPrompt === null ? 'neutral' : 'success')}
          data-testid="object-prompt-box-summary"
        >
          {state.boxPrompt === null ? t('editor.masks.objectPrompt.box') : t('editor.masks.objectPrompt.boxReady')}
        </span>
      </div>
      <button
        className="flex min-h-7 w-full items-center justify-center gap-2 rounded bg-editor-primary-active px-2 py-1.5 text-xs font-medium text-editor-primary-active-text transition-colors hover:bg-editor-primary-active/90 disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
        data-object-prompt-command-ready={String(commandInput !== null)}
        data-object-prompt-provider-status={providerStatusText}
        data-testid="object-prompt-generate-proposal"
        disabled={commandInput === null || isGenerating || !selectedImagePath || hasPendingProposal}
        aria-busy={isGenerating}
        onClick={() => {
          onGenerate();
        }}
        type="button"
      >
        {isGenerating && <Loader2 size={14} className="animate-spin" />}
        <span className="truncate">{t('editor.masks.objectPrompt.generate')}</span>
      </button>
      <ObjectPromptReviewActions
        hasPendingProposal={hasPendingProposal}
        onAccept={onAccept}
        onCancelProposal={onCancelProposal}
        t={t}
      />
      {replayReceipt !== null && (
        <UiText
          as="div"
          variant={TextVariants.small}
          color={TextColors.secondary}
          className="mt-2 truncate text-[11px]"
          data-has-raster={String(replayReceipt.hasRaster)}
          data-image-height={replayReceipt.imageHeight}
          data-image-width={replayReceipt.imageWidth}
          data-model-id={replayReceipt.modelId}
          data-point-count={replayReceipt.pointCount}
          data-prompt-count={replayReceipt.promptCount}
          data-prompt-kind={replayReceipt.promptKind}
          data-provider-id={replayReceipt.providerId}
          data-provider-status={replayReceipt.providerStatus}
          data-receipt-version={replayReceipt.receiptVersion}
          data-testid="object-prompt-replay-receipt"
        >
          {t('editor.masks.objectPrompt.receipt', {
            latency: replayReceipt.clickToMaskLatencyMs,
            promptKind: replayReceipt.promptKind,
            provider: replayReceipt.providerStatus,
          })}
        </UiText>
      )}
    </div>
  );
}
