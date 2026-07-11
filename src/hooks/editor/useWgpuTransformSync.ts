import { invoke } from '@tauri-apps/api/core';
import { type RefObject, useEffect, useRef } from 'react';
import type { TransformState } from '../../components/ui/AppProperties';
import { Invokes } from '../../tauri/commands';
import type { EditorPresentationDescriptor } from '../../utils/editorPresentationDescriptor';
import {
  buildHiddenWgpuTransformPayload,
  buildVisibleWgpuTransformPayload,
  fingerprintWgpuTransformPayload,
  parseCssRgbColor,
  type RgbaColor,
  shouldSubmitVisibleWgpuTransform,
} from '../../utils/wgpuTransformPayload';
import type { RenderSize } from '../viewport/useImageRenderSize';

interface WgpuRenderState {
  bgPrimary: RgbaColor;
  bgSecondary: RgbaColor;
  hasRenderedFirstFrame: boolean;
  isCropping: boolean;
  isReady: boolean;
  showOriginal: boolean;
  uncroppedAdjustedPreviewUrl: string | null;
  useWgpuRenderer: boolean | undefined;
}

interface UseWgpuTransformSyncOptions {
  finalPreviewUrl: string | null;
  hasRenderedFirstFrame: boolean;
  imageContainerRef: RefObject<HTMLDivElement | null>;
  imageRenderSizeRef: RefObject<RenderSize>;
  isCropping: boolean;
  isReady: boolean;
  maxScaleRef: RefObject<number>;
  onWgpuFrameCommitted?: (() => void) | undefined;
  onWgpuFailure?: (() => void) | undefined;
  presentationDescriptor: EditorPresentationDescriptor;
  showOriginal: boolean;
  theme: string | undefined;
  transformStateRef: RefObject<TransformState>;
  uncroppedAdjustedPreviewUrl: string | null;
  useWgpuRenderer: boolean | undefined;
}

const MIN_VISIBLE_CONTAINER_PX = 10;
const DEFAULT_BG_PRIMARY = 'rgb(24, 24, 24)';
const DEFAULT_BG_SECONDARY = 'rgb(35, 35, 35)';

export function useWgpuTransformSync({
  finalPreviewUrl: _finalPreviewUrl,
  hasRenderedFirstFrame,
  imageContainerRef,
  imageRenderSizeRef,
  isCropping,
  isReady,
  maxScaleRef,
  onWgpuFrameCommitted,
  onWgpuFailure,
  presentationDescriptor,
  showOriginal,
  theme,
  transformStateRef,
  uncroppedAdjustedPreviewUrl,
  useWgpuRenderer,
}: UseWgpuTransformSyncOptions) {
  const wgpuSyncRef = useRef<number | null>(null);
  const lastWgpuTransformRef = useRef<string | null>(null);
  const wgpuStateRef = useRef<WgpuRenderState>({
    useWgpuRenderer,
    isReady,
    hasRenderedFirstFrame,
    isCropping,
    uncroppedAdjustedPreviewUrl,
    showOriginal,
    bgPrimary: [24 / 255, 24 / 255, 24 / 255, 1.0],
    bgSecondary: [35 / 255, 35 / 255, 35 / 255, 1.0],
  });

  useEffect(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const bgPrimaryStr = rootStyle.getPropertyValue('--app-bg-primary') || DEFAULT_BG_PRIMARY;
    const bgSecondaryStr = rootStyle.getPropertyValue('--app-bg-secondary') || DEFAULT_BG_SECONDARY;

    wgpuStateRef.current = {
      useWgpuRenderer,
      isReady,
      hasRenderedFirstFrame,
      isCropping,
      uncroppedAdjustedPreviewUrl,
      showOriginal,
      bgPrimary: parseCssRgbColor(bgPrimaryStr),
      bgSecondary: parseCssRgbColor(bgSecondaryStr),
    };
  }, [
    useWgpuRenderer,
    isReady,
    hasRenderedFirstFrame,
    isCropping,
    uncroppedAdjustedPreviewUrl,
    showOriginal,
    theme,
    _finalPreviewUrl,
  ]);

  useEffect(() => {
    let isEffectActive = true;
    let isInvoking = false;

    const syncWgpu = () => {
      if (!isEffectActive) return;

      const state = wgpuStateRef.current;
      const container = imageContainerRef.current;

      if (!container) {
        wgpuSyncRef.current = requestAnimationFrame(syncWgpu);
        return;
      }

      const currentRect = container.getBoundingClientRect();

      if (currentRect.width < MIN_VISIBLE_CONTAINER_PX || currentRect.height < MIN_VISIBLE_CONTAINER_PX) {
        wgpuSyncRef.current = requestAnimationFrame(syncWgpu);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const windowWidth = Math.max(window.innerWidth * dpr, 1);
      const windowHeight = Math.max(window.innerHeight * dpr, 1);
      const colors = {
        bgPrimary: state.bgPrimary,
        bgSecondary: state.bgSecondary,
      };

      const payload = !shouldSubmitVisibleWgpuTransform(state.useWgpuRenderer, state.isReady)
        ? buildHiddenWgpuTransformPayload({ containerRect: currentRect, dpr, windowWidth, windowHeight }, colors)
        : buildVisibleWgpuTransformPayload(
            {
              containerRect: currentRect,
              dpr,
              imageRenderSize: imageRenderSizeRef.current,
              maxScale: maxScaleRef.current,
              transformState: transformStateRef.current,
              windowWidth,
              windowHeight,
            },
            colors,
            state.isCropping && Boolean(state.uncroppedAdjustedPreviewUrl),
          );

      const currentTransform = fingerprintWgpuTransformPayload(payload);

      if (lastWgpuTransformRef.current !== currentTransform && !isInvoking) {
        lastWgpuTransformRef.current = currentTransform;
        isInvoking = true;

        invoke<number>(Invokes.UpdateWgpuTransform, { payload })
          .then(async (sequence) => {
            if (sequence === 0) {
              lastWgpuTransformRef.current = null;
              return;
            }
            await invoke(Invokes.FlushWgpuPresentation, { sequence });
            if (state.useWgpuRenderer === true && state.isReady && state.hasRenderedFirstFrame) {
              onWgpuFrameCommitted?.();
            }
          })
          .catch((err: unknown) => {
            if (state.useWgpuRenderer !== false && state.isReady && state.hasRenderedFirstFrame) {
              console.warn('WGPU Sync Error:', err);
              onWgpuFailure?.();
            }
          })
          .finally(() => {
            isInvoking = false;
          });
      }

      wgpuSyncRef.current = requestAnimationFrame(syncWgpu);
    };

    wgpuSyncRef.current = requestAnimationFrame(syncWgpu);

    return () => {
      isEffectActive = false;
      if (wgpuSyncRef.current !== null) {
        cancelAnimationFrame(wgpuSyncRef.current);
      }
    };
  }, [
    imageContainerRef,
    imageRenderSizeRef,
    maxScaleRef,
    onWgpuFrameCommitted,
    onWgpuFailure,
    presentationDescriptor.fingerprint,
    transformStateRef,
  ]);
}
