import { useTranslation } from 'react-i18next';
import { imageCanvasLayerZIndex } from './imageCanvasContracts';

interface CompareOverlayProps {
  canShowOriginalCompare: boolean;
  compareOverlayDisabled: boolean;
  isCompareModeActive: boolean;
  isMaxZoom: boolean | undefined;
  originalSrc: string | null;
  previewSource: string;
  showSideBySideCompare: boolean;
  showSplitCompare: boolean;
}

export function CompareOverlay({
  canShowOriginalCompare,
  compareOverlayDisabled,
  isCompareModeActive,
  isMaxZoom,
  originalSrc,
  previewSource,
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
          className="pointer-events-none absolute inset-0 grid grid-cols-2 gap-2 bg-editor-panel-well/95 p-2"
          data-canvas-pointer-owner="pan-zoom"
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
    </>
  );
}
