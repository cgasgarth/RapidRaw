import { useTranslation } from 'react-i18next';
import type { EditorReferenceViewState } from '../../../utils/editorReferenceView';

interface ReferenceViewOverlayProps {
  activePath: string;
  state: EditorReferenceViewState;
  onClear: () => void;
  onChoose: () => void;
  onFocus: (pane: 'active' | 'reference') => void;
  onToggleSync: () => void;
}

export function ReferenceViewOverlay({
  activePath,
  onChoose,
  onClear,
  onFocus,
  onToggleSync,
  state,
}: ReferenceViewOverlayProps) {
  const { t } = useTranslation();
  if (state.mode === 'off') return null;
  const activeLabel = activePath.split(/[\\/]/).pop() ?? activePath;
  return (
    <div
      aria-label={t('editor.referenceView.ariaLabel', { defaultValue: 'Reference View' })}
      className="pointer-events-none absolute inset-x-2 top-2 z-30 flex items-start justify-between gap-2"
      data-reference-view={state.reference ? 'ready' : 'choose-reference'}
      data-testid="editor-reference-view"
    >
      <div className="pointer-events-auto flex max-w-[45%] flex-col gap-1 rounded border border-editor-border bg-editor-panel/95 px-2 py-1 text-[11px] text-text-primary shadow">
        <button
          aria-pressed={state.activePane === 'reference'}
          className="truncate text-left font-medium hover:text-editor-focus-ring"
          data-testid="editor-reference-view-reference-pane"
          onClick={() => onFocus('reference')}
          type="button"
        >
          {state.reference?.label ?? t('editor.referenceView.chooseReference', { defaultValue: 'Choose reference…' })}
        </button>
        <span className="text-[10px] text-text-secondary">
          {state.reference === null
            ? t('editor.referenceView.chooseHint', { defaultValue: 'Select an image in the filmstrip' })
            : t('editor.referenceView.readOnly', { defaultValue: 'Read-only reference' })}
        </span>
      </div>
      <div className="pointer-events-auto flex items-center gap-1 rounded border border-editor-border bg-editor-panel/95 px-1 py-1 shadow">
        <button
          aria-pressed={state.activePane === 'active'}
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-editor-panel-well"
          data-testid="editor-reference-view-active-pane"
          onClick={() => onFocus('active')}
          type="button"
        >
          {t('editor.referenceView.active', { defaultValue: 'Active' })}: {activeLabel}
        </button>
        <button
          aria-pressed={state.synchronizedTransform}
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-editor-panel-well"
          data-testid="editor-reference-view-sync"
          onClick={onToggleSync}
          type="button"
        >
          {state.synchronizedTransform
            ? t('editor.referenceView.sync', { defaultValue: 'Sync' })
            : t('editor.referenceView.independent', { defaultValue: 'Independent' })}
        </button>
        <button
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-editor-panel-well"
          data-testid="editor-reference-view-choose"
          onClick={onChoose}
          type="button"
        >
          {t('editor.referenceView.replace', { defaultValue: 'Replace' })}
        </button>
        <button
          className="rounded px-1.5 py-0.5 text-[10px] text-editor-warning hover:bg-editor-panel-well"
          data-testid="editor-reference-view-clear"
          onClick={onClear}
          type="button"
        >
          {t('editor.referenceView.clear', { defaultValue: 'Clear' })}
        </button>
      </div>
    </div>
  );
}
