import { Loader2, RotateCcw, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLightroomAiSceneMasks } from '../../../../hooks/ai/useLightroomAiSceneMasks';
import type { LightroomAiSceneMaskCapability } from '../../../../utils/ai/lightroomAiSceneMaskGeneration';

const actions: ReadonlyArray<LightroomAiSceneMaskCapability> = ['subject', 'sky', 'background'];

/** Compact semantic-mask chooser. Results remain previews until Apply is pressed. */
export function LightroomAiSceneMaskChooser() {
  const { t } = useTranslation();
  const { apply, cancel, job, refine, retry, start } = useLightroomAiSceneMasks();
  const [refineValue, setRefineValue] = useState('');
  const isBusy = job?.status === 'queued' || job?.status === 'running';

  return (
    <section
      aria-label={t('editor.masks.aiScene.ariaLabel')}
      className="mb-2 rounded-md border border-editor-border bg-editor-panel-well p-2"
      data-testid="lightroom-ai-scene-mask-chooser"
      data-mask-status={job?.status ?? 'idle'}
      data-mask-progress={job?.progress ?? 0}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] font-medium text-text-primary">
          <Sparkles size={13} /> {t('editor.masks.aiScene.title')}
        </span>
        {job !== null && <span className="text-[10px] text-text-tertiary">{job.authority.providerId}</span>}
      </div>
      <div className="grid grid-cols-3 gap-1" role="group" aria-label={t('editor.masks.aiScene.select')}>
        {actions.map((action) => (
          <button
            className="rounded border border-editor-border bg-editor-panel px-1.5 py-1 text-[11px] text-text-secondary transition-colors hover:bg-editor-panel-raised disabled:cursor-not-allowed disabled:opacity-50"
            data-testid={`lightroom-ai-scene-mask-${action}`}
            disabled={isBusy}
            key={action}
            onClick={() => void start(action)}
            type="button"
          >
            {t(`editor.masks.aiScene.${action}`)}
          </button>
        ))}
      </div>
      {isBusy && job !== null && (
        <div
          className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-text-secondary"
          data-testid="lightroom-ai-scene-mask-progress"
        >
          <span className="flex items-center gap-1">
            <Loader2 className="animate-spin" size={12} /> {t('editor.masks.aiScene.analyzing')}
          </span>
          <button
            className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-editor-panel-raised"
            data-testid="lightroom-ai-scene-mask-cancel"
            onClick={cancel}
            type="button"
          >
            <X size={12} /> {t('editor.masks.aiScene.cancel')}
          </button>
        </div>
      )}
      {job?.status === 'preview' && job.result !== null && (
        <div className="mt-1.5 space-y-1.5" data-testid="lightroom-ai-scene-mask-preview">
          <div className="text-[10px] text-text-secondary">{t('editor.masks.aiScene.previewReady')}</div>
          <div className="flex gap-1">
            <input
              aria-label={t('editor.masks.aiScene.refine')}
              className="min-w-0 flex-1 rounded border border-editor-border bg-editor-panel px-1.5 py-1 text-[10px] text-text-primary"
              data-testid="lightroom-ai-scene-mask-refine-input"
              onChange={(event) => setRefineValue(event.target.value)}
              placeholder={t('editor.masks.aiScene.refinePlaceholder')}
              value={refineValue}
            />
            <button
              className="rounded border border-editor-border px-1.5 text-[10px] text-text-secondary hover:bg-editor-panel-raised"
              data-testid="lightroom-ai-scene-mask-refine"
              onClick={() => {
                if (refineValue.trim()) refine({ refinementNote: refineValue.trim() });
              }}
              type="button"
            >
              {t('editor.masks.aiScene.refine')}
            </button>
          </div>
          <div className="flex justify-end gap-1">
            <button
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-text-secondary hover:bg-editor-panel-raised"
              data-testid="lightroom-ai-scene-mask-cancel-preview"
              onClick={cancel}
              type="button"
            >
              <X size={12} /> {t('editor.masks.aiScene.cancel')}
            </button>
            <button
              className="rounded bg-editor-primary-active px-2 py-1 text-[10px] font-medium text-white hover:opacity-90"
              data-testid="lightroom-ai-scene-mask-apply"
              onClick={() => void apply()}
              type="button"
            >
              {t('editor.masks.aiScene.apply')}
            </button>
          </div>
        </div>
      )}
      {job?.status === 'failed' && (
        <div
          className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-amber-200"
          data-testid="lightroom-ai-scene-mask-failure"
        >
          <span>{job.errorMessage ?? t('editor.masks.aiScene.failed')}</span>
          <button
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 hover:bg-editor-panel-raised"
            data-testid="lightroom-ai-scene-mask-retry"
            onClick={retry}
            type="button"
          >
            <RotateCcw size={12} /> {t('editor.masks.aiScene.retry')}
          </button>
        </div>
      )}
      {job?.status === 'cancelled' && (
        <div className="mt-1 text-[10px] text-text-tertiary" data-testid="lightroom-ai-scene-mask-cancelled">
          {t('editor.masks.aiScene.cancelled')}
        </div>
      )}
    </section>
  );
}
