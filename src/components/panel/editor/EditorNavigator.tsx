import cx from 'clsx';
import { Loader2, TriangleAlert } from 'lucide-react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { type NavigatorPreviewArtifact, useEditorStore } from '../../../store/useEditorStore';
import { getNavigatorPanTransform, getNavigatorViewportRect } from '../../../utils/editorNavigator';
import type { ViewportSnapshot, ViewportTransform } from '../../../utils/editorViewportBounds';
import {
  type EditorZoomCommand,
  formatEditorZoomLabel,
  getEditorZoomSourceSize,
  resolveEditorZoom,
} from '../../../utils/editorZoom';
import { editorChromeTokens } from '../../ui/editorChromeTokens';

export interface EditorTransformController {
  instance?: {
    readonly transformState: ViewportTransform;
  };
  setTransform(x: number, y: number, scale: number, time?: number): void;
}

interface EditorNavigatorProps {
  onZoomChange: (command: EditorZoomCommand) => void;
  transformControllerRef: RefObject<EditorTransformController | null>;
}

export type NavigatorPreviewState =
  | { artifact: null; phase: 'empty' }
  | { artifact: NavigatorPreviewArtifact; phase: 'error' | 'loading' | 'ready' };

export type NavigatorPreviewEvent =
  | { artifactId: string; type: 'image-error' }
  | { artifactId: string; type: 'image-load' };

export function createNavigatorPreviewState(artifact: NavigatorPreviewArtifact | null): NavigatorPreviewState {
  return artifact === null ? { artifact: null, phase: 'empty' } : { artifact, phase: 'loading' };
}

export function navigatorPreviewReducer(
  state: NavigatorPreviewState,
  event: NavigatorPreviewEvent,
): NavigatorPreviewState {
  if (state.artifact === null || state.artifact.id !== event.artifactId) return state;
  return { artifact: state.artifact, phase: event.type === 'image-load' ? 'ready' : 'error' };
}

const sameTransform = (left: ViewportTransform, right: ViewportTransform): boolean =>
  left.scale === right.scale && left.positionX === right.positionX && left.positionY === right.positionY;

export function resolveNavigatorTransformUpdate(
  current: ViewportTransform,
  candidate: ViewportTransform,
): ViewportTransform {
  if (
    !Number.isFinite(candidate.scale) ||
    candidate.scale <= 0 ||
    !Number.isFinite(candidate.positionX) ||
    !Number.isFinite(candidate.positionY) ||
    sameTransform(current, candidate)
  ) {
    return current;
  }
  return { ...candidate };
}

export default function EditorNavigator(props: EditorNavigatorProps) {
  const identity = useEditorStore(
    useShallow((state) => ({ artifact: state.navigatorPreviewArtifact, imageSessionId: state.imageSessionId })),
  );
  const sessionKey = identity.artifact?.id ?? `empty:${String(identity.imageSessionId)}`;
  return <EditorNavigatorSession {...props} artifact={identity.artifact} key={sessionKey} />;
}

interface EditorNavigatorSessionProps extends EditorNavigatorProps {
  artifact: NavigatorPreviewArtifact | null;
}

function EditorNavigatorSession({ artifact, onZoomChange, transformControllerRef }: EditorNavigatorSessionProps) {
  const { t } = useTranslation();
  const editor = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments,
      baseRenderSize: state.baseRenderSize,
      compare: state.compare,
      originalSize: state.originalSize,
      selectedImage: state.selectedImage,
      zoomMode: state.zoomMode,
    })),
  );
  const [transform, setTransform] = useState<ViewportTransform>(
    () => transformControllerRef.current?.instance?.transformState ?? { positionX: 0, positionY: 0, scale: 1 },
  );
  const publishedTransformRef = useRef(transform);
  const [preview, dispatchPreview] = useReducer(navigatorPreviewReducer, artifact, createNavigatorPreviewState);
  const [imageBox, setImageBox] = useState({ height: 0, left: 0, top: 0, width: 0 });
  const imageRef = useRef<HTMLImageElement | null>(null);
  const overviewRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const identity = artifact?.id ?? 'empty';

  useEffect(() => {
    const overview = overviewRef.current;
    return () => {
      const pointerId = pointerIdRef.current;
      if (pointerId !== null && overview?.hasPointerCapture(pointerId)) overview.releasePointerCapture(pointerId);
      dragOffsetRef.current = null;
      pointerIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const synchronize = () => {
      const next = transformControllerRef.current?.instance?.transformState;
      if (next) {
        const resolved = resolveNavigatorTransformUpdate(publishedTransformRef.current, next);
        if (resolved !== publishedTransformRef.current) {
          publishedTransformRef.current = resolved;
          setTransform(resolved);
        }
      }
      frame = requestAnimationFrame(synchronize);
    };
    frame = requestAnimationFrame(synchronize);
    return () => cancelAnimationFrame(frame);
  }, [transformControllerRef]);

  const sourceSize = useMemo(
    () =>
      getEditorZoomSourceSize({
        crop: editor.adjustments.crop,
        orientationSteps: editor.adjustments.orientationSteps,
        originalSize: editor.originalSize,
      }),
    [editor.adjustments.crop, editor.adjustments.orientationSteps, editor.originalSize],
  );
  const snapshot: ViewportSnapshot = useMemo(() => {
    const scale = editor.baseRenderSize.width / Math.max(sourceSize.width, 1);
    return {
      containerHeight: editor.baseRenderSize.containerHeight,
      containerWidth: editor.baseRenderSize.containerWidth,
      renderSize: { ...editor.baseRenderSize, scale },
    };
  }, [editor.baseRenderSize, sourceSize.width]);
  const viewport = useMemo(() => getNavigatorViewportRect(snapshot, transform), [snapshot, transform]);
  const resolvedZoom = useMemo(
    () =>
      resolveEditorZoom({
        devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
        mode: editor.zoomMode,
        renderSize: {
          height: editor.baseRenderSize.height,
          scale: editor.baseRenderSize.width / Math.max(sourceSize.width, 1),
          width: editor.baseRenderSize.width,
        },
        sourceSize,
        viewportSize: {
          height: editor.baseRenderSize.containerHeight,
          width: editor.baseRenderSize.containerWidth,
        },
      }),
    [editor.baseRenderSize, editor.zoomMode, sourceSize],
  );
  const zoomLabel = formatEditorZoomLabel(resolvedZoom, {
    fill: t('editor.viewerFooter.zoom.fill'),
    fit: t('editor.viewerFooter.zoom.fit'),
  });
  const isFit = editor.zoomMode.kind === 'fit';

  const updateImageBox = useCallback(() => {
    const imageBounds = imageRef.current?.getBoundingClientRect();
    const overviewBounds = overviewRef.current?.getBoundingClientRect();
    if (!imageBounds || !overviewBounds) return;
    setImageBox({
      height: imageBounds.height,
      left: imageBounds.left - overviewBounds.left,
      top: imageBounds.top - overviewBounds.top,
      width: imageBounds.width,
    });
  }, []);

  useEffect(() => {
    const overview = overviewRef.current;
    if (!overview || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateImageBox);
    observer.observe(overview);
    return () => observer.disconnect();
  }, [updateImageBox]);

  const panTo = useCallback(
    (point: { x: number; y: number }) => {
      if (isFit || snapshot.containerWidth <= 0 || snapshot.containerHeight <= 0) return;
      const next = getNavigatorPanTransform({ imagePoint: point, snapshot, transform });
      transformControllerRef.current?.setTransform(next.positionX, next.positionY, next.scale);
    },
    [isFit, snapshot, transform, transformControllerRef],
  );

  const pointFromPointer = (event: PointerEvent<HTMLElement>) => {
    const bounds = imageRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isFit || event.button !== 0) return;
    const point = pointFromPointer(event);
    if (!point) return;
    const inside =
      point.x >= viewport.x &&
      point.x <= viewport.x + viewport.width &&
      point.y >= viewport.y &&
      point.y <= viewport.y + viewport.height;
    dragOffsetRef.current = inside
      ? { x: point.x - (viewport.x + viewport.width / 2), y: point.y - (viewport.y + viewport.height / 2) }
      : { x: 0, y: 0 };
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    panTo({ x: point.x - dragOffsetRef.current.x, y: point.y - dragOffsetRef.current.y });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId || !dragOffsetRef.current) return;
    const point = pointFromPointer(event);
    if (!point) return;
    event.preventDefault();
    panTo({ x: point.x - dragOffsetRef.current.x, y: point.y - dragOffsetRef.current.y });
  };

  const releasePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    pointerIdRef.current = null;
    dragOffsetRef.current = null;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.shiftKey ? 0.1 : 0.025;
    const directions: Record<string, { x: number; y: number }> = {
      ArrowDown: { x: 0, y: delta },
      ArrowLeft: { x: -delta, y: 0 },
      ArrowRight: { x: delta, y: 0 },
      ArrowUp: { x: 0, y: -delta },
    };
    const direction = directions[event.key];
    if (!direction || isFit) return;
    event.preventDefault();
    panTo({
      x: viewport.x + viewport.width / 2 + direction.x,
      y: viewport.y + viewport.height / 2 + direction.y,
    });
  };

  const zoomButtons: Array<{ command: EditorZoomCommand; label: string }> = [
    { command: { kind: 'fit' }, label: t('editor.viewerFooter.zoom.fit') },
    { command: { kind: 'fill' }, label: t('editor.viewerFooter.zoom.fill') },
    { command: { kind: 'one-to-one' }, label: t('editor.viewerFooter.zoom.oneToOne') },
    { command: { kind: 'two-to-one' }, label: t('editor.viewerFooter.zoom.twoToOne') },
  ];
  const isZoomCommandSelected = (command: EditorZoomCommand): boolean => {
    if (command.kind === 'fit' || command.kind === 'fill') return editor.zoomMode.kind === command.kind;
    if (editor.zoomMode.kind !== 'ratio') return false;
    const ratio = command.kind === 'one-to-one' ? 1 : command.kind === 'two-to-one' ? 2 : null;
    return ratio !== null && Math.abs(editor.zoomMode.devicePixelsPerImagePixel - ratio) < 0.001;
  };

  return (
    <div
      className="space-y-2 p-2"
      data-preview-graph={artifact?.graphIdentity ?? ''}
      data-preview-identity={identity}
      data-preview-session={artifact?.imageSessionId ?? ''}
      data-testid="editor-navigator"
    >
      {/* i18next-instrument-ignore */}
      <div
        aria-disabled={isFit}
        aria-label="Image Navigator viewport"
        className={cx(
          'relative flex aspect-[4/3] w-full touch-none items-center justify-center overflow-hidden bg-editor-matte',
          editorChromeTokens.focusRing,
          !isFit && 'cursor-crosshair',
        )}
        data-testid="editor-navigator-overview"
        onKeyDown={handleKeyDown}
        onPointerCancel={releasePointer}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointer}
        role="application"
        ref={overviewRef}
        tabIndex={isFit ? -1 : 0}
      >
        {preview.artifact && (
          <img
            alt=""
            className="max-h-full max-w-full select-none object-contain"
            draggable={false}
            onError={() => {
              dispatchPreview({ artifactId: preview.artifact.id, type: 'image-error' });
            }}
            onLoad={() => {
              updateImageBox();
              dispatchPreview({ artifactId: preview.artifact.id, type: 'image-load' });
            }}
            ref={imageRef}
            src={preview.artifact.url}
          />
        )}
        {preview.phase === 'loading' && (
          <Loader2 aria-label="Loading Navigator preview" className="absolute animate-spin" size={18} />
        )}
        {preview.phase === 'error' && (
          <TriangleAlert aria-label="Navigator preview unavailable" className="absolute" size={18} />
        )}
        {preview.phase === 'empty' && (
          /* i18next-instrument-ignore */
          <span className="text-xs text-text-tertiary">Refining</span>
        )}
        {preview.phase === 'ready' && (
          <div
            className="pointer-events-none absolute"
            style={{ height: imageBox.height, left: imageBox.left, top: imageBox.top, width: imageBox.width }}
          >
            <div
              aria-label={`Visible viewport at ${Math.round((viewport.x + viewport.width / 2) * 100)}%, ${Math.round((viewport.y + viewport.height / 2) * 100)}%`}
              className="absolute border-2 border-white bg-transparent shadow-[0_0_0_999px_rgba(0,0,0,0.38),0_0_0_1px_rgba(0,0,0,0.9)]"
              data-testid="editor-navigator-viewport"
              style={{
                height: `${viewport.height * 100}%`,
                left: `${viewport.x * 100}%`,
                top: `${viewport.y * 100}%`,
                width: `${viewport.width * 100}%`,
              }}
            />
          </div>
        )}
      </div>
      {/* i18next-instrument-ignore */}
      <div className="grid grid-cols-4 gap-1" aria-label="Navigator zoom modes" role="group">
        {zoomButtons.map(({ command, label }) => (
          <button
            aria-pressed={isZoomCommandSelected(command)}
            className={cx(
              editorChromeTokens.button.base,
              editorChromeTokens.button.quiet,
              'h-7 min-w-0 px-1 text-[10px]',
            )}
            key={label}
            onClick={() => onZoomChange(command)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="text-center text-[10px] tabular-nums text-text-secondary"
        data-testid="editor-navigator-zoom-readout"
      >
        {zoomLabel}
        {editor.compare.mode !== 'off' ? ' · Edited' : ''}
      </div>
    </div>
  );
}
