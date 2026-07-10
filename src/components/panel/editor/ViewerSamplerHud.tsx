import { Lock, Unlock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ViewerSampleResult, ViewerSampleTarget } from '../../../utils/viewerSampler';
import { imageCanvasLayerZIndex } from './imageCanvasContracts';

export interface ViewerSamplerState {
  locked: boolean;
  onToggleLock: () => void;
  result: ViewerSampleResult | null;
  suppressed: boolean;
  target: ViewerSampleTarget;
}

interface ViewerSamplerHudProps extends ViewerSamplerState {
  placement?: 'footer' | 'overlay';
}

const targetLabel = (target: ViewerSampleTarget): string => {
  if (target === 'softProof') return 'Soft proof';
  return target === 'original' ? 'Original' : 'Edited';
};

const unavailableLabel = (result: Extract<ViewerSampleResult, { status: 'unavailable' }> | null): string => {
  if (result?.reason === 'staleFrame') return 'Settling';
  if (result?.reason === 'unsupportedSpace') return 'Space unavailable';
  return 'Unavailable';
};

export function ViewerSamplerHud({
  locked,
  onToggleLock,
  placement = 'overlay',
  result,
  suppressed,
  target,
}: ViewerSamplerHudProps) {
  const { t } = useTranslation();
  const available = result?.status === 'available' ? result : null;
  const unavailable = result?.status === 'unavailable' ? result : null;
  const rgb = available?.rgb.map((channel) => Math.round(channel * 255)) ?? null;

  return (
    <div
      aria-live="polite"
      className={
        placement === 'overlay'
          ? 'pointer-events-auto absolute bottom-2 left-1/2 flex h-8 max-w-[calc(100%-16px)] -translate-x-1/2 items-center gap-2 overflow-hidden rounded border border-editor-overlay-stroke bg-editor-panel/95 px-2 text-[11px] tabular-nums text-text-primary shadow-lg'
          : 'flex min-w-0 max-w-80 items-center gap-1 overflow-hidden text-[10px] tabular-nums text-text-primary'
      }
      data-sampler-locked={String(locked)}
      data-sampler-status={suppressed ? 'suppressed' : (result?.status ?? 'idle')}
      data-sampler-target={target}
      data-testid="viewer-sampler-hud"
      style={placement === 'overlay' ? { zIndex: imageCanvasLayerZIndex('viewerHud') } : undefined}
    >
      <button
        aria-label={locked ? 'Unlock viewer sample' : 'Lock viewer sample'}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-editor-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring disabled:opacity-40"
        disabled={suppressed || result === null}
        onClick={(event) => {
          event.stopPropagation();
          onToggleLock();
        }}
        title={locked ? 'Unlock viewer sample' : 'Lock viewer sample'}
        type="button"
      >
        {locked ? <Unlock aria-hidden="true" size={14} /> : <Lock aria-hidden="true" size={14} />}
      </button>
      <span className="shrink-0 font-medium">{targetLabel(target)}</span>
      {suppressed ? (
        <span className="text-text-secondary">{t('editor.canvas.sampler.paused')}</span>
      ) : available && rgb ? (
        <>
          <span className="hidden shrink-0 sm:inline">
            X {available.imagePointPx.x} Y {available.imagePointPx.y}
          </span>
          <span className="shrink-0">
            R {rgb[0]} G {rgb[1]} B {rgb[2]}
          </span>
          <span className="hidden shrink-0 md:inline">Y {(available.luma * 100).toFixed(1)}%</span>
          {available.clippedChannels.length > 0 && (
            <span className="shrink-0 font-semibold uppercase text-editor-danger">
              {t('editor.canvas.sampler.clipped', { channels: available.clippedChannels.join('') })}
            </span>
          )}
          <span className="hidden min-w-0 truncate text-text-secondary lg:inline">{available.spaceLabel}</span>
        </>
      ) : (
        <span className="text-text-secondary">{unavailableLabel(unavailable)}</span>
      )}
    </div>
  );
}
