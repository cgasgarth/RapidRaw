import cx from 'clsx';
import type { TFunction } from 'i18next';
import { Loader2 } from 'lucide-react';
import { TextColors, TextVariants } from '../../../../types/typography';

import type {
  ObjectMaskProposalCommandInput,
  ObjectMaskProposalReplayReceipt,
  ObjectPromptCanvasState,
  ObjectPromptMode,
} from '../../../../utils/objectMaskPromptCanvas';
import UiText from '../../../ui/primitives/Text';

interface ObjectPromptControlsProps {
  commandInput: ObjectMaskProposalCommandInput | null;
  isGenerating: boolean;
  onClear: () => void;
  onGenerate: () => void;
  onModeChange: (mode: ObjectPromptMode) => void;
  providerStatusText: string;
  replayReceipt: ObjectMaskProposalReplayReceipt | null;
  selectedImagePath: string | undefined;
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

export function ObjectPromptControls({
  commandInput,
  isGenerating,
  onClear,
  onGenerate,
  onModeChange,
  providerStatusText,
  replayReceipt,
  selectedImagePath,
  state,
  t,
}: ObjectPromptControlsProps) {
  return (
    <div
      className="rounded-md border border-surface bg-bg-primary p-2"
      data-object-prompt-box-ready={String(state.boxPrompt !== null)}
      data-object-prompt-mode={state.mode}
      data-object-prompt-point-count={state.pointPrompts.length}
      data-testid="object-prompt-controls"
    >
      <div className="grid grid-cols-4 gap-1">
        {OBJECT_PROMPT_MODE_ACTIONS.map((action) => (
          <button
            className={cx(
              'min-w-0 rounded px-2 py-1 text-xs transition-colors',
              state.mode === action.mode
                ? 'bg-accent text-white'
                : 'bg-bg-secondary text-text-secondary hover:text-text-primary',
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
          className="min-w-0 rounded bg-bg-secondary px-2 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary"
          data-testid="object-prompt-clear"
          onClick={onClear}
          type="button"
        >
          <span className="block truncate">{t('editor.masks.objectPrompt.clear')}</span>
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-text-tertiary">
        <span data-testid="object-prompt-point-summary">
          {t('editor.masks.objectPrompt.points', { count: state.pointPrompts.length })}
        </span>
        <span data-testid="object-prompt-box-summary">
          {state.boxPrompt === null ? t('editor.masks.objectPrompt.box') : t('editor.masks.objectPrompt.boxReady')}
        </span>
      </div>
      <button
        className="mt-2 flex w-full items-center justify-center gap-2 rounded bg-accent px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        data-object-prompt-command-ready={String(commandInput !== null)}
        data-object-prompt-provider-status={providerStatusText}
        data-testid="object-prompt-generate-proposal"
        disabled={commandInput === null || isGenerating || !selectedImagePath}
        onClick={() => {
          onGenerate();
        }}
        type="button"
      >
        {isGenerating && <Loader2 size={14} className="animate-spin" />}
        <span className="truncate">{t('editor.masks.objectPrompt.generate')}</span>
      </button>
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
