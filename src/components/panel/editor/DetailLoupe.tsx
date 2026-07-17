import cx from 'clsx';
import { Crosshair, Loader2, TriangleAlert } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditDocumentGeometryCropV2 } from '../../../../packages/rawengine-schema/src/editDocumentV2';
import {
  type DetailLoupeIdentity,
  type DetailLoupePhase,
  type DetailLoupeRect,
  type DetailLoupeTarget,
  type DetailModifierPreview,
  resolveDetailLoupeBackground,
  resolveDetailLoupePhase,
} from '../../../utils/detailLoupe';

interface DetailLoupeProps {
  crop?: EditDocumentGeometryCropV2 | null;
  devicePixelRatio: number;
  diagnosticMode?: DetailModifierPreview | null;
  imageRect: DetailLoupeRect;
  orientationSteps: number;
  previewUrl: string | null;
  resolutionState: 'ready' | 'settling' | 'limited';
  sourceSize: { readonly height: number; readonly width: number };
  currentIdentity: DetailLoupeIdentity | null;
  target: DetailLoupeTarget | null;
  visible?: boolean;
  onTargetChange?: (target: DetailLoupeTarget) => void;
}

const statusCopy: Record<DetailLoupePhase, { label: string; tone: string }> = {
  current: { label: 'Current 1:1 pixels', tone: 'text-editor-success' },
  pending: { label: 'Loupe pending render', tone: 'text-editor-warning' },
  error: { label: 'Loupe unavailable', tone: 'text-editor-danger' },
};

export default function DetailLoupe({
  crop = null,
  currentIdentity,
  devicePixelRatio,
  diagnosticMode = null,
  imageRect,
  onTargetChange,
  orientationSteps,
  previewUrl,
  resolutionState,
  sourceSize,
  target,
  visible = false,
}: DetailLoupeProps) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(false);
  const phase = resolveDetailLoupePhase({ currentIdentity, previewUrl, resolutionState, target });
  const backgroundStyle = useMemo(
    () =>
      target === null
        ? undefined
        : resolveDetailLoupeBackground({
            devicePixelRatio,
            imageRect,
            orientationSteps,
            sourceSize,
            target,
          }),
    [devicePixelRatio, imageRect, orientationSteps, sourceSize, target],
  );

  useEffect(() => {
    if (!dragging) return;
    const stopDragging = () => {
      dragRef.current = false;
      setDragging(false);
    };
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
    window.addEventListener('blur', stopDragging);
    return () => {
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
      window.removeEventListener('blur', stopDragging);
    };
  }, [dragging]);

  const copy = statusCopy[phase];
  const loupeLabel = t('adjustments.details.loupe', { defaultValue: 'Detail loupe' });
  const diagnosticLabel =
    diagnosticMode === null ? null : `${diagnosticMode === 'sharpening' ? 'Sharpening' : 'Noise reduction'} preview`;
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (target === null || onTargetChange === undefined) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = true;
    setDragging(true);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current || target === null || onTargetChange === undefined) return;
    const dx = event.movementX / Math.max(1, imageRect.width);
    const dy = event.movementY / Math.max(1, imageRect.height);
    onTargetChange({
      ...target,
      x: Math.min(1, Math.max(0, target.x + dx)),
      y: Math.min(1, Math.max(0, target.y + dy)),
    });
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = false;
    setDragging(false);
  };

  if (!visible) return null;

  return (
    <aside
      aria-label={loupeLabel}
      className="pointer-events-none absolute right-3 top-3 z-[145] w-56 rounded-md border border-editor-overlay-stroke bg-editor-overlay-surface/95 p-2 text-[11px] shadow-[0_14px_34px_var(--editor-overlay-shadow)]"
      data-detail-loupe-phase={phase}
      data-detail-loupe-render-revision={String(currentIdentity?.renderRevision ?? '')}
      data-detail-loupe-source={currentIdentity?.sourceIdentity ?? ''}
      data-testid="detail-loupe"
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-text-primary">
        <span className="font-medium">{loupeLabel}</span>
        <span className="font-mono text-text-tertiary">{t('editor.viewerFooter.zoom.oneToOne')}</span>
      </div>
      <div
        className={cx(
          'relative h-36 overflow-hidden rounded border border-editor-border bg-editor-viewer-matte',
          diagnosticMode === 'sharpening' && 'ring-1 ring-editor-info/70',
          diagnosticMode === 'noise-reduction' && 'ring-1 ring-editor-warning/70',
        )}
        data-detail-loupe-crop={
          crop ? `${String(crop.x)}:${String(crop.y)}:${String(crop.width)}:${String(crop.height)}` : 'none'
        }
        data-detail-loupe-diagnostic={diagnosticMode ?? 'none'}
      >
        {target !== null && previewUrl !== null && phase === 'current' && (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-no-repeat [image-rendering:auto]"
            style={{ ...backgroundStyle, backgroundImage: `url("${previewUrl.replaceAll('"', '\\"')}")` }}
            data-testid="detail-loupe-pixels"
          />
        )}
        {target !== null && (
          <button
            aria-label={t('adjustments.details.moveLoupeTarget')}
            className={cx(
              'pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/90 bg-black/20 p-1 text-white shadow-[0_0_0_1px_rgba(0,0,0,.7)]',
              dragging && 'cursor-grabbing',
            )}
            data-testid="detail-loupe-target"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            type="button"
          >
            <Crosshair aria-hidden="true" size={18} />
          </button>
        )}
        {phase !== 'current' && (
          <div className="absolute inset-0 flex items-center justify-center gap-1 bg-editor-viewer-matte/80 px-2 text-center">
            {phase === 'error' ? (
              <TriangleAlert aria-hidden="true" size={14} />
            ) : (
              <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" size={14} />
            )}
            <span className={copy.tone} data-testid="detail-loupe-status">
              {copy.label}
            </span>
          </div>
        )}
        {diagnosticLabel !== null && (
          <span
            className="absolute bottom-1 left-1 rounded bg-editor-overlay-surface/90 px-1.5 py-0.5 text-[10px] text-editor-info"
            data-testid="detail-loupe-diagnostic-label"
          >
            {diagnosticLabel}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-text-tertiary">
        <span data-testid="detail-loupe-target-readout">
          {target ? `${Math.round(target.x * 100)}%, ${Math.round(target.y * 100)}%` : 'Move over image'}
        </span>
        <span>{copy.label}</span>
      </div>
    </aside>
  );
}
