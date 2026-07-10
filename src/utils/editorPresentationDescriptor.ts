import type { EditorOverlayGeometry, OverlayRect, OverlaySize } from './editorOverlayGeometry';
import type { ResolvedEditorZoom } from './editorZoom';

export type EditorPresentationQuality = 'interactive' | 'settled';

export interface EditorPresentationDescriptor {
  readonly alphaPolicy: 'preserve-over-matte';
  readonly colorTransformIdentity: string;
  readonly compareIdentity: string;
  readonly cropRectInOrientedPixels: OverlayRect<'oriented-pixels'>;
  readonly devicePixelRatio: number;
  readonly displayedImageRectInViewCssPixels: OverlayRect<'view-css-pixels'>;
  readonly displayedImageRectInViewportCssPixels: OverlayRect<'viewport-css-pixels'>;
  readonly fingerprint: string;
  readonly geometryEpoch: number;
  readonly graphRevision: string;
  readonly orientationSteps: 0 | 1 | 2 | 3;
  readonly overlayIdentity: string;
  readonly proofTransformIdentity: string;
  readonly quality: EditorPresentationQuality;
  readonly semanticZoom: ResolvedEditorZoom;
  readonly sourceIdentity: string;
  readonly sourceSize: OverlaySize;
  readonly textureSize: OverlaySize;
}

export interface CreateEditorPresentationDescriptorInput {
  readonly colorTransformIdentity: string;
  readonly compareIdentity: string;
  readonly geometry: EditorOverlayGeometry;
  readonly graphRevision: string;
  readonly overlayIdentity: string;
  readonly proofTransformIdentity: string;
  readonly quality: EditorPresentationQuality;
  readonly sourceIdentity: string;
  readonly textureSize: OverlaySize;
}

const freezeSize = (size: OverlaySize): OverlaySize => Object.freeze({ height: size.height, width: size.width });

export const createEditorPresentationDescriptor = (
  input: CreateEditorPresentationDescriptorInput,
): EditorPresentationDescriptor => {
  const identity = {
    colorTransformIdentity: input.colorTransformIdentity,
    compareIdentity: input.compareIdentity,
    cropRectInOrientedPixels: input.geometry.cropRectInOrientedPixels,
    devicePixelRatio: input.geometry.devicePixelRatio,
    displayedImageRectInViewCssPixels: input.geometry.displayedImageRectInViewCssPixels,
    displayedImageRectInViewportCssPixels: input.geometry.displayedImageRectInViewportCssPixels,
    geometryEpoch: input.geometry.geometryEpoch,
    graphRevision: input.graphRevision,
    orientationSteps: input.geometry.orientationSteps,
    overlayIdentity: input.overlayIdentity,
    proofTransformIdentity: input.proofTransformIdentity,
    quality: input.quality,
    semanticZoom: input.geometry.semanticZoom,
    sourceIdentity: input.sourceIdentity,
    sourceSize: input.geometry.sourceSize,
    textureSize: input.textureSize,
  };

  return Object.freeze({
    ...identity,
    alphaPolicy: 'preserve-over-matte',
    fingerprint: JSON.stringify(identity),
    sourceSize: freezeSize(identity.sourceSize),
    textureSize: freezeSize(identity.textureSize),
  });
};

export interface RendererHandoffState {
  readonly committedBackend: 'cpu' | 'wgpu';
  readonly committedFingerprint: string;
  readonly generation: number;
  readonly pendingWgpuFrameSerial: number;
  readonly status: 'cpu' | 'degraded' | 'waiting-wgpu' | 'wgpu';
}

export const createRendererHandoffState = (
  descriptor: EditorPresentationDescriptor,
  wgpuFrameSerial: number,
): RendererHandoffState =>
  Object.freeze({
    committedBackend: 'cpu',
    committedFingerprint: descriptor.fingerprint,
    generation: 1,
    pendingWgpuFrameSerial: wgpuFrameSerial,
    status: 'cpu',
  });

export const advanceRendererHandoff = ({
  descriptor,
  failed = false,
  state,
  useWgpuRenderer,
  wgpuFrameSerial,
}: {
  readonly descriptor: EditorPresentationDescriptor;
  readonly failed?: boolean;
  readonly state: RendererHandoffState;
  readonly useWgpuRenderer: boolean;
  readonly wgpuFrameSerial: number;
}): RendererHandoffState => {
  if (descriptor.fingerprint !== state.committedFingerprint) {
    return Object.freeze({
      committedBackend: 'cpu',
      committedFingerprint: descriptor.fingerprint,
      generation: state.generation + 1,
      pendingWgpuFrameSerial: wgpuFrameSerial,
      status: useWgpuRenderer ? 'waiting-wgpu' : 'cpu',
    });
  }
  if (!useWgpuRenderer) return Object.freeze({ ...state, committedBackend: 'cpu', status: 'cpu' });
  if (failed) {
    return Object.freeze({
      ...state,
      committedBackend: 'cpu',
      pendingWgpuFrameSerial: wgpuFrameSerial,
      status: 'degraded',
    });
  }
  if (wgpuFrameSerial > state.pendingWgpuFrameSerial) {
    return Object.freeze({ ...state, committedBackend: 'wgpu', status: 'wgpu' });
  }
  return Object.freeze({ ...state, committedBackend: 'cpu', status: 'waiting-wgpu' });
};
