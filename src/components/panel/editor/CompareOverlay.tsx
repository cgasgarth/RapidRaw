import { useTranslation } from 'react-i18next';
import type { EditorCompareMode } from '../../../store/useEditorStore';
import { imageCanvasLayerZIndex } from './imageCanvasContracts';

type PreviewCompareStripMode = Exclude<EditorCompareMode, 'off'>;

interface CompareOverlayProps {
  canShowOriginalCompare: boolean;
  compareMode: EditorCompareMode;
  compareOverlayDisabled: boolean;
  isCompareModeActive: boolean;
  isCropping: boolean;
  isMaxZoom: boolean | undefined;
  onCompareModeChange: (mode: EditorCompareMode) => void;
  onShowOriginalChange: (showOriginal: boolean) => void;
  originalSrc: string | null;
  previewSource: string;
  showOriginal: boolean;
  showSideBySideCompare: boolean;
  showSplitCompare: boolean;
}

export function CompareOverlay({
  canShowOriginalCompare,
  compareMode,
  compareOverlayDisabled,
  isCompareModeActive,
  isCropping,
  isMaxZoom,
  onCompareModeChange,
  onShowOriginalChange,
  originalSrc,
  previewSource,
  showOriginal,
  showSideBySideCompare,
  showSplitCompare,
}: CompareOverlayProps) {
  const { t } = useTranslation();

  return (
    <>
      {showSplitCompare && (
        <div
          aria-label={t('editor.canvas.compare.splitWipeDivider')}
          className="pointer-events-none absolute top-0 h-full"
          data-testid="editor-compare-split-divider"
          style={{
            background: 'rgba(255, 255, 255, 0.82)',
            boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.55), 0 0 18px rgba(0, 0, 0, 0.45)',
            left: '50%',
            opacity: canShowOriginalCompare ? 1 : 0.4,
            width: '1px',
            zIndex: imageCanvasLayerZIndex('viewerHud'),
          }}
        >
          <span
            className="absolute left-1/2 top-3 -translate-x-1/2 rounded border border-editor-overlay-stroke bg-editor-panel/90 px-2 py-1 text-[11px] font-medium text-text-primary"
            data-testid="editor-compare-split-label"
          >
            {canShowOriginalCompare
              ? t('editor.canvas.compare.splitWipeLabel')
              : t('editor.canvas.compare.loadingOriginal')}
          </span>
        </div>
      )}
      {showSideBySideCompare && (
        <div
          aria-label={t('editor.canvas.compare.sideBySideRegion')}
          className="absolute inset-0 grid grid-cols-2 gap-2 bg-editor-panel-well/95 p-2"
          data-testid="editor-compare-side-by-side-preview"
          style={{ zIndex: imageCanvasLayerZIndex('viewerHud') }}
        >
          {[
            { label: t('editor.canvas.compare.before'), src: originalSrc },
            { label: t('editor.canvas.compare.after'), src: previewSource },
          ].map((pane) => (
            <div
              className="relative min-h-0 overflow-hidden rounded-md border border-editor-overlay-stroke bg-black"
              data-compare-pane={pane.label}
              key={pane.label}
            >
              {pane.src ? (
                <img
                  alt={pane.label}
                  className="h-full w-full object-contain"
                  src={pane.src}
                  style={{ imageRendering: isMaxZoom ? 'pixelated' : 'auto' }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-text-secondary">
                  {t('editor.canvas.compare.loadingOriginal')}
                </div>
              )}
              <span className="absolute left-3 top-3 rounded border border-editor-overlay-stroke bg-editor-panel/90 px-2 py-1 text-[11px] font-medium text-text-primary">
                {pane.label}
              </span>
            </div>
          ))}
        </div>
      )}
      {isCompareModeActive && !compareOverlayDisabled && !canShowOriginalCompare && (
        <div
          className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-editor-warning/50 bg-editor-warning-surface px-3 py-2 text-xs font-medium text-editor-warning"
          data-testid="editor-compare-loading-reason"
          style={{ zIndex: imageCanvasLayerZIndex('viewerHud') }}
        >
          {t('editor.canvas.compare.loadingOriginal')}
        </div>
      )}
      {compareOverlayDisabled && (
        <div
          className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-editor-warning/50 bg-editor-warning-surface px-3 py-2 text-xs font-medium text-editor-warning"
          data-testid="editor-compare-overlay-disabled-reason"
          style={{ zIndex: imageCanvasLayerZIndex('viewerHud') }}
        >
          {t('editor.canvas.compare.overlayDisabled')}
        </div>
      )}
      {!isCropping && (
        <div
          className="pointer-events-auto absolute left-1/2 top-3 flex max-w-[min(92%,520px)] -translate-x-1/2 items-center gap-1 rounded-md border border-editor-overlay-stroke bg-editor-panel/92 px-1.5 py-1 text-[11px] shadow-[0_12px_30px_var(--editor-overlay-shadow)] backdrop-blur"
          data-compare-active={String(isCompareModeActive)}
          data-compare-original-ready={String(canShowOriginalCompare)}
          data-compare-show-original={String(showOriginal)}
          data-preview-compare-mode={compareMode}
          data-testid="editor-preview-compare-strip"
          style={{ zIndex: imageCanvasLayerZIndex('viewerHud') }}
        >
          <span className="shrink-0 px-1.5 font-medium text-text-secondary">
            {t('editor.canvas.compare.stripTitle')}
          </span>
          {(['hold-original', 'split-wipe', 'side-by-side'] satisfies PreviewCompareStripMode[]).map((mode) => {
            const isActive = compareMode === mode;
            const label =
              mode === 'hold-original'
                ? t('editor.canvas.compare.stripMode.hold-original')
                : mode === 'split-wipe'
                  ? t('editor.canvas.compare.stripMode.split-wipe')
                  : t('editor.canvas.compare.stripMode.side-by-side');
            return (
              <button
                aria-label={label}
                aria-pressed={isActive}
                className={[
                  'h-7 rounded px-2 text-[11px] font-medium transition',
                  isActive
                    ? 'bg-text-primary text-bg-primary shadow-sm'
                    : 'bg-editor-panel-well text-text-secondary hover:bg-editor-hover hover:text-text-primary',
                ].join(' ')}
                data-testid={`editor-preview-compare-${mode}`}
                key={mode}
                onClick={() => onCompareModeChange(isActive ? 'off' : mode)}
                onPointerDown={(event) => {
                  if (mode === 'hold-original' && event.button === 0) onShowOriginalChange(true);
                }}
                onPointerLeave={(event) => {
                  if (mode === 'hold-original' && event.buttons === 1) onShowOriginalChange(false);
                }}
                onPointerUp={() => {
                  if (mode === 'hold-original') onShowOriginalChange(false);
                }}
                type="button"
              >
                {label}
              </button>
            );
          })}
          {isCompareModeActive && (
            <button
              aria-label={t('editor.canvas.compare.stripOff')}
              className="h-7 rounded px-2 text-[11px] font-medium text-text-secondary transition hover:bg-editor-hover hover:text-text-primary"
              data-testid="editor-preview-compare-off"
              onClick={() => onCompareModeChange('off')}
              type="button"
            >
              {t('editor.canvas.compare.stripOff')}
            </button>
          )}
        </div>
      )}
    </>
  );
}
