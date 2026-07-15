import { z } from 'zod';
import {
  fingerprintPreviewRoi,
  type PreviewRoi,
  type PreviewViewportSnapshot,
  quantizePreviewRoi,
} from './previewCoordinator';

const finiteNumberSchema = z.number().finite();
const positiveFiniteNumberSchema = finiteNumberSchema.positive();
const revisionSchema = z.number().int().nonnegative().safe();
const positiveRevisionSchema = z.number().int().positive().safe();

const viewportLayoutSchema = z
  .object({
    containerHeight: finiteNumberSchema,
    containerWidth: finiteNumberSchema,
    height: finiteNumberSchema,
    offsetX: finiteNumberSchema,
    offsetY: finiteNumberSchema,
    width: finiteNumberSchema,
  })
  .strict();

const viewportTransformSchema = z
  .object({
    positionX: finiteNumberSchema,
    positionY: finiteNumberSchema,
    scale: positiveFiniteNumberSchema,
  })
  .strict();

const viewportQualityPolicySchema = z
  .object({
    editorPreviewResolution: positiveFiniteNumberSchema,
    enableZoomHifi: z.boolean(),
    highResZoomMultiplier: positiveFiniteNumberSchema,
    useFullDpiRendering: z.boolean(),
  })
  .strict();

const zoomModeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fit') }).strict(),
  z.object({ kind: z.literal('fill') }).strict(),
  z
    .object({
      devicePixelsPerImagePixel: positiveFiniteNumberSchema,
      kind: z.literal('ratio'),
    })
    .strict(),
]);

const roiSchema = z
  .tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema, finiteNumberSchema])
  .readonly()
  .nullable();

export const previewViewportAuthorityInputSchema = z
  .object({
    devicePixelRatio: positiveFiniteNumberSchema,
    geometryRevision: revisionSchema,
    layout: viewportLayoutSchema,
    qualityPolicy: viewportQualityPolicySchema,
    roi: roiSchema,
    sourceImagePath: z.string().trim().min(1),
    sourceRevision: positiveRevisionSchema,
    targetHeight: positiveRevisionSchema,
    targetWidth: positiveRevisionSchema,
    transform: viewportTransformSchema,
    zoomMode: zoomModeSchema,
  })
  .strict();

export type PreviewViewportAuthorityInput = z.infer<typeof previewViewportAuthorityInputSchema>;

export interface PreviewViewportAuthoritySnapshot {
  readonly coordinator: Readonly<PreviewViewportSnapshot>;
  readonly fingerprint: string;
  readonly input: Readonly<PreviewViewportAuthorityInput>;
  readonly roi: PreviewRoi;
}

const freezeInput = (input: PreviewViewportAuthorityInput): Readonly<PreviewViewportAuthorityInput> =>
  Object.freeze({
    ...input,
    layout: Object.freeze({ ...input.layout }),
    qualityPolicy: Object.freeze({ ...input.qualityPolicy }),
    roi: input.roi === null ? null : (Object.freeze([...input.roi]) as PreviewRoi),
    transform: Object.freeze({ ...input.transform }),
    zoomMode: Object.freeze({ ...input.zoomMode }),
  });

const quantizeRoiForTarget = (roi: PreviewRoi, targetWidth: number, targetHeight: number): PreviewRoi => {
  if (roi === null) return null;
  const xAxis = quantizePreviewRoi([roi[0], 0, roi[2], 1], targetWidth);
  const yAxis = quantizePreviewRoi([0, roi[1], 1, roi[3]], targetHeight);
  if (xAxis === null || yAxis === null) return null;
  return Object.freeze([xAxis[0], yAxis[1], xAxis[2], yAxis[3]]) as PreviewRoi;
};

/**
 * Owns the causal viewport identity used by preview scheduling. React supplies
 * immutable inputs; only this controller decides whether the viewport changed.
 */
export class PreviewViewportSnapshotController {
  private currentSnapshot: PreviewViewportAuthoritySnapshot | null = null;
  private nextRevision = 1;

  snapshot(input: PreviewViewportAuthorityInput): PreviewViewportAuthoritySnapshot {
    const parsed = previewViewportAuthorityInputSchema.parse(input);
    const roi = quantizeRoiForTarget(parsed.roi, parsed.targetWidth, parsed.targetHeight);
    const { roi: _unquantizedRoi, ...identityInput } = parsed;
    const fingerprint = JSON.stringify({ ...identityInput, roi });
    if (this.currentSnapshot?.fingerprint === fingerprint) return this.currentSnapshot;

    const coordinator = Object.freeze({
      revision: this.nextRevision,
      roiFingerprint: fingerprintPreviewRoi(roi),
      targetHeight: parsed.targetHeight,
      targetWidth: parsed.targetWidth,
    });
    const snapshot = Object.freeze({
      coordinator,
      fingerprint,
      input: freezeInput({ ...parsed, roi }),
      roi,
    });
    this.currentSnapshot = snapshot;
    this.nextRevision += 1;
    return snapshot;
  }

  current(): PreviewViewportAuthoritySnapshot | null {
    return this.currentSnapshot;
  }
}
