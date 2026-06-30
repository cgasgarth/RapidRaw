import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TransformState } from '../../components/ui/AppProperties';
import { getImageTransformBounds, type TransformBounds } from '../../utils/editorViewportBounds';
import type { RenderSize } from './useImageRenderSize';

interface EditorViewportPhysicsOptions {
  contentRef: RefObject<HTMLDivElement | null>;
  hasSelectedImage: boolean;
  imageContainerRef: RefObject<HTMLDivElement | null>;
  imageRenderSize: RenderSize;
  onZoomed: (state: TransformState) => void;
}

export function useEditorViewportPhysics({
  contentRef,
  hasSelectedImage,
  imageContainerRef,
  imageRenderSize,
  onZoomed,
}: EditorViewportPhysicsOptions) {
  const [transformState, setTransformState] = useState<TransformState>({ scale: 1, positionX: 0, positionY: 0 });
  const [isPanningState, setIsPanningState] = useState(false);
  const [isMiddleMousePanningState, setIsMiddleMousePanningState] = useState(false);
  const transformStateRef = useRef<TransformState>(transformState);
  const imageRenderSizeRef = useRef(imageRenderSize);
  const zoomDebounceTimeoutRef = useRef<number | null>(null);
  const focalPointRef = useRef({ x: 0.5, y: 0.5 });
  const isTransitioningRef = useRef(false);
  const animationFrameId = useRef<number | null>(null);
  const physicsFrameId = useRef<number | null>(null);
  const wheelSnapTimeout = useRef<number | null>(null);

  const transformConfig = useMemo(() => {
    if (!hasSelectedImage || !imageRenderSize.scale) {
      return { minScale: 0.1, maxScale: 20 };
    }

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const scaleFor100Percent = 1 / imageRenderSize.scale;

    const minScale = (0.1 / dpr) * scaleFor100Percent;
    const maxScale = (2.0 / dpr) * scaleFor100Percent;

    return {
      minScale: Math.max(0.1, minScale),
      maxScale: Math.max(20, maxScale),
    };
  }, [hasSelectedImage, imageRenderSize.scale]);

  const minScaleRef = useRef(transformConfig.minScale);
  const maxScaleRef = useRef(transformConfig.maxScale);

  useLayoutEffect(() => {
    transformStateRef.current = transformState;
    imageRenderSizeRef.current = imageRenderSize;
  }, [imageRenderSize, transformState]);

  useEffect(() => {
    minScaleRef.current = transformConfig.minScale;
    maxScaleRef.current = transformConfig.maxScale;
  }, [transformConfig.minScale, transformConfig.maxScale]);

  const getTransformBounds = useCallback(
    (scale: number): TransformBounds => {
      const container = imageContainerRef.current;
      if (!container) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };

      const cw = container.clientWidth;
      const ch = container.clientHeight;
      return getImageTransformBounds({
        containerHeight: ch,
        containerWidth: cw,
        renderSize: imageRenderSizeRef.current,
        scale,
      });
    },
    [imageContainerRef],
  );

  const clampToBounds = useCallback(
    (x: number, y: number, scale: number) => {
      const safeScale = Math.min(
        Math.max(Number.isFinite(scale) ? scale : 1, minScaleRef.current),
        maxScaleRef.current,
      );

      const bounds = getTransformBounds(safeScale);
      const safeX = Number.isFinite(x) ? x : 0;
      const safeY = Number.isFinite(y) ? y : 0;

      return {
        x: Math.min(Math.max(safeX, bounds.minX), bounds.maxX),
        y: Math.min(Math.max(safeY, bounds.minY), bounds.maxY),
        scale: safeScale,
      };
    },
    [getTransformBounds],
  );

  const applyTransform = useCallback(
    (x: number, y: number, scale: number) => {
      transformStateRef.current = { positionX: x, positionY: y, scale };
      setTransformState({ scale, positionX: x, positionY: y });

      if (contentRef.current) {
        contentRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      }

      if (!isTransitioningRef.current) {
        if (scale > 1.01) {
          const container = imageContainerRef.current;
          if (container) {
            const cw = container.offsetWidth;
            const ch = container.offsetHeight;
            focalPointRef.current = {
              x: (cw / 2 - x) / (cw * scale),
              y: (ch / 2 - y) / (ch * scale),
            };
          }
        } else {
          focalPointRef.current = { x: 0.5, y: 0.5 };
        }
      }

      if (zoomDebounceTimeoutRef.current) clearTimeout(zoomDebounceTimeoutRef.current);
      zoomDebounceTimeoutRef.current = window.setTimeout(() => {
        onZoomed({ scale, positionX: x, positionY: y });
      }, 100);
    },
    [contentRef, imageContainerRef, onZoomed],
  );

  const animateTransform = useCallback(
    (targetX: number, targetY: number, targetScale: number, duration: number) => {
      if (physicsFrameId.current) cancelAnimationFrame(physicsFrameId.current);

      const startX = transformStateRef.current.positionX;
      const startY = transformStateRef.current.positionY;
      const startScale = transformStateRef.current.scale;
      const boundedTarget = clampToBounds(targetX, targetY, targetScale);
      const startTime = performance.now();

      const step = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeProgress = 1 - (1 - progress) ** 3;

        applyTransform(
          startX + (boundedTarget.x - startX) * easeProgress,
          startY + (boundedTarget.y - startY) * easeProgress,
          startScale + (boundedTarget.scale - startScale) * easeProgress,
        );

        if (progress < 1) {
          animationFrameId.current = requestAnimationFrame(step);
        }
      };

      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = requestAnimationFrame(step);
    },
    [applyTransform, clampToBounds],
  );

  const startPhysicsLoop = useCallback(
    (initialVx: number, initialVy: number) => {
      if (physicsFrameId.current) cancelAnimationFrame(physicsFrameId.current);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);

      let vx = initialVx;
      let vy = initialVy;
      let lastTime = performance.now();

      const step = (time: number) => {
        const dt = Math.min(time - lastTime, 32);
        lastTime = time;

        const { scale } = transformStateRef.current;
        let { positionX: x, positionY: y } = transformStateRef.current;
        const bounds = getTransformBounds(scale);

        x += vx * dt;
        y += vy * dt;

        const decay = 0.994 ** dt;
        vx *= decay;
        vy *= decay;

        const outOfBounds = x > bounds.maxX || x < bounds.minX || y > bounds.maxY || y < bounds.minY;

        if (outOfBounds) {
          vx *= 0.5;
          vy *= 0.5;

          const correction = 0.15;
          if (x > bounds.maxX) x += (bounds.maxX - x) * correction;
          else if (x < bounds.minX) x += (bounds.minX - x) * correction;

          if (y > bounds.maxY) y += (bounds.maxY - y) * correction;
          else if (y < bounds.minY) y += (bounds.minY - y) * correction;
        }

        applyTransform(x, y, scale);

        const speed = Math.hypot(vx, vy);

        if (speed < 0.02 && !outOfBounds) {
          const finalPos = clampToBounds(x, y, scale);
          if (Math.abs(x - finalPos.x) > 0.05 || Math.abs(y - finalPos.y) > 0.05) {
            applyTransform(finalPos.x, finalPos.y, scale);
          }
          return;
        }

        if (outOfBounds && speed < 0.05 && Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) {
          const dist = Math.max(
            x > bounds.maxX ? x - bounds.maxX : x < bounds.minX ? bounds.minX - x : 0,
            y > bounds.maxY ? y - bounds.maxY : y < bounds.minY ? bounds.minY - y : 0,
          );
          if (dist < 0.5) {
            const finalPos = clampToBounds(x, y, scale);
            applyTransform(finalPos.x, finalPos.y, scale);
            return;
          }
        }

        physicsFrameId.current = requestAnimationFrame(step);
      };

      physicsFrameId.current = requestAnimationFrame(step);
    },
    [applyTransform, clampToBounds, getTransformBounds],
  );

  return {
    animationFrameId,
    animateTransform,
    applyTransform,
    clampToBounds,
    focalPointRef,
    getTransformBounds,
    imageRenderSizeRef,
    isMiddleMousePanningState,
    isPanningState,
    isTransitioningRef,
    maxScaleRef,
    minScaleRef,
    physicsFrameId,
    setIsMiddleMousePanningState,
    setIsPanningState,
    startPhysicsLoop,
    transformConfig,
    transformState,
    transformStateRef,
    wheelSnapTimeout,
  };
}
