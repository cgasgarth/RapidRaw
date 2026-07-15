import type { ExecutedEditedPreview, MaterializedEditedPreview } from './editedPreviewEffectRunner';
import { decodeInteractivePreviewUrl, parseInteractivePreviewPatchPayload } from './interactivePreviewPatch';
import type { PreviewPresentationValue } from './previewPresentationAdapter';

export interface PreviewMaterializationContext {
  kind: 'interactive' | 'settled';
  roi: readonly [number, number, number, number] | null;
}

export interface PreviewMaterializationAdapterOptions {
  createObjectUrl?: (blob: Blob) => string;
  decodeUrl?: (url: string) => Promise<void>;
  now?: () => number;
  releaseUrl: (url: string) => void;
}

/** Owns buffer classification, decode, and temporary URL failure cleanup. */
export class PreviewMaterializationAdapter {
  private readonly createObjectUrl: (blob: Blob) => string;
  private readonly decodeUrl: (url: string) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: PreviewMaterializationAdapterOptions) {
    this.createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.decodeUrl = options.decodeUrl ?? decodeInteractivePreviewUrl;
    this.now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
  }

  async materialize(
    result: ExecutedEditedPreview,
    context: PreviewMaterializationContext,
  ): Promise<MaterializedEditedPreview<PreviewPresentationValue>> {
    const { buffer, transform } = result;
    if (buffer.byteLength === 0) return { value: { kind: 'empty' } };
    const prefix = new TextDecoder().decode(buffer.slice(0, 11));
    if (prefix === 'WGPU_RENDER') return { value: { kind: 'wgpu' } };

    const positioned = context.kind === 'interactive' || context.roi !== null;
    const patch = positioned ? parseInteractivePreviewPatchPayload(buffer) : null;
    if (patch !== null && !patch.ok) return { value: { kind: 'limited', reason: patch.reason } };

    const blob = new Blob([patch?.ok ? patch.imageBuffer : buffer], { type: 'image/jpeg' });
    const url = this.createObjectUrl(blob);
    const decodeStartedAt = this.now();
    try {
      await this.decodeUrl(url);
    } catch (error) {
      this.options.releaseUrl(url);
      throw error;
    }
    const decodeMs = Math.max(0, this.now() - decodeStartedAt);
    return patch?.ok
      ? { decodeMs, value: { kind: 'patch', patch, url } }
      : { artifactUrl: url, decodeMs, value: { kind: 'full', transform, url } };
  }
}
