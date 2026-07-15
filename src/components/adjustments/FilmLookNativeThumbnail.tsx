import cx from 'clsx';
import { useEffect, useRef, useState } from 'react';

import type { FilmThumbnailResultV1 } from '../../../packages/rawengine-schema/src/index.js';
import {
  cancelFilmProfileThumbnail,
  releaseFilmProfileThumbnail,
  renderFilmProfileThumbnail,
} from '../../tauri/filmThumbnails';
import type { Adjustments } from '../../utils/adjustments';
import { buildFilmLookAppliedAdjustmentPatch, type FilmLookBrowserItem } from '../../utils/film-look/filmLookBrowser';

type ThumbnailState =
  | { status: 'idle' | 'queued' | 'rendering'; dataUrl: null; reason: null }
  | {
      status: 'ready';
      dataUrl: string;
      reason: null;
      cacheStatus: FilmThumbnailResultV1['cacheStatus'];
      elapsedMs: number;
      payloadBytes: number;
    }
  | { status: 'stale' | 'cancelled' | 'unavailable' | 'error'; dataUrl: null; reason: string | null };

export interface FilmLookNativeThumbnailProps {
  baseAdjustments: Readonly<Adjustments>;
  allowRetry?: boolean;
  className?: string;
  graphRevision: number;
  height: number;
  look: FilmLookBrowserItem;
  pinned: boolean;
  retryLabel: string;
  selectedImageId: string | null;
  strength: number;
  testId?: string;
  viewOutputSha256: string;
  width: number;
  cancelThumbnail?: (requestId: string) => Promise<boolean>;
  releaseThumbnail?: (key: string) => Promise<boolean>;
  renderThumbnail?: typeof renderFilmProfileThumbnail;
}

const initialState: ThumbnailState = { status: 'idle', dataUrl: null, reason: null };

export function FilmLookNativeThumbnail({
  allowRetry = true,
  baseAdjustments,
  cancelThumbnail = cancelFilmProfileThumbnail,
  className,
  graphRevision,
  height,
  look,
  pinned,
  releaseThumbnail = releaseFilmProfileThumbnail,
  renderThumbnail = renderFilmProfileThumbnail,
  retryLabel,
  selectedImageId,
  strength,
  testId,
  viewOutputSha256,
  width,
}: FilmLookNativeThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const [thumbnail, setThumbnail] = useState<ThumbnailState>(initialState);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        setIsVisible(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: '160px' },
    );
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isVisible || selectedImageId === null) {
      setThumbnail(initialState);
      return;
    }

    const requestId = crypto.randomUUID();
    activeRequestIdRef.current = requestId;
    let disposed = false;
    let publishedCacheKey: string | null = null;
    setThumbnail({ status: 'queued', dataUrl: null, reason: null });

    const adjustments: Adjustments = {
      ...baseAdjustments,
      ...buildFilmLookAppliedAdjustmentPatch(look, strength),
      filmEmulation: null,
      filmLookId: look.id,
      filmLookStrength: strength,
    };

    void (async () => {
      setThumbnail({ status: 'rendering', dataUrl: null, reason: null });
      let result: FilmThumbnailResultV1;
      try {
        result = await renderThumbnail({
          adjustments,
          graphRevision,
          height,
          lookId: look.id,
          pinned,
          requestId,
          selectedImageId,
          viewOutputSha256,
          width,
        });
      } catch (error) {
        if (!disposed && activeRequestIdRef.current === requestId) {
          setThumbnail({
            status: 'error',
            dataUrl: null,
            reason: error instanceof Error ? error.message : 'Native thumbnail render failed.',
          });
        }
        return;
      }

      if (disposed || activeRequestIdRef.current !== requestId) return;
      if (result.status === 'ready') {
        publishedCacheKey = result.key;
        setThumbnail(
          result.dataUrl === null || result.payloadBytes === null
            ? { status: 'error', dataUrl: null, reason: 'Native renderer returned no thumbnail payload.' }
            : {
                status: 'ready',
                dataUrl: result.dataUrl,
                reason: null,
                cacheStatus: result.cacheStatus,
                elapsedMs: result.elapsedMs,
                payloadBytes: result.payloadBytes,
              },
        );
        return;
      }
      setThumbnail({ status: result.status, dataUrl: null, reason: result.rejectionReason });
    })();

    return () => {
      disposed = true;
      if (activeRequestIdRef.current === requestId) activeRequestIdRef.current = null;
      void cancelThumbnail(requestId).catch(() => false);
      if (pinned && publishedCacheKey !== null) {
        void releaseThumbnail(publishedCacheKey).catch(() => false);
      }
    };
  }, [
    baseAdjustments,
    cancelThumbnail,
    graphRevision,
    height,
    isVisible,
    look,
    pinned,
    releaseThumbnail,
    renderThumbnail,
    retryRevision,
    selectedImageId,
    strength,
    viewOutputSha256,
    width,
  ]);

  const canRetry = allowRetry && (thumbnail.status === 'error' || thumbnail.status === 'unavailable');

  return (
    <div
      className={cx('relative overflow-hidden rounded bg-editor-panel-raised', className)}
      data-look-id={look.id}
      data-native-film-thumbnail="true"
      data-thumbnail-cache-status={thumbnail.status === 'ready' ? thumbnail.cacheStatus : undefined}
      data-thumbnail-elapsed-ms={thumbnail.status === 'ready' ? thumbnail.elapsedMs : undefined}
      data-thumbnail-payload-bytes={thumbnail.status === 'ready' ? thumbnail.payloadBytes : undefined}
      data-thumbnail-state={selectedImageId === null ? 'unavailable' : thumbnail.status}
      data-testid={testId}
      ref={containerRef}
    >
      {thumbnail.dataUrl !== null ? (
        <img
          alt={`${look.displayName} rendered preview`}
          className="size-full object-cover"
          draggable={false}
          height={height}
          src={thumbnail.dataUrl}
          width={width}
        />
      ) : (
        <div
          aria-label={`${look.displayName} preview ${selectedImageId === null ? 'unavailable' : thumbnail.status}`}
          className="flex size-full items-center justify-center bg-editor-panel-raised px-1 text-center text-[9px] text-text-secondary"
          role="img"
        >
          {selectedImageId === null
            ? 'Open an image'
            : thumbnail.status === 'error' || thumbnail.status === 'unavailable'
              ? 'Preview unavailable'
              : 'Rendering…'}
        </div>
      )}
      {canRetry && (
        <button
          aria-label={`${retryLabel} ${look.displayName}`}
          className="absolute inset-0 size-full bg-black/20 text-[10px] text-white opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-editor-focus-ring"
          onClick={(event) => {
            event.stopPropagation();
            setRetryRevision((revision) => revision + 1);
          }}
          type="button"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export default FilmLookNativeThumbnail;
