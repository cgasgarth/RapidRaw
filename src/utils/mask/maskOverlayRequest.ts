import type { EditDocumentV2 } from '../../../packages/rawengine-schema/src/editDocumentV2';
import type { SubMask } from '../../components/panel/right/layers/Masks';
import type { RenderSize } from '../../hooks/viewport/useImageRenderSize';
import type { MaskOverlaySettings } from '../../schemas/masks/maskOverlaySchemas';
import type { Adjustments, AiPatch, MaskContainer } from '../adjustments';
import { selectEditDocumentGeometry, selectEditDocumentNode } from '../editDocumentSelectors';
import { normalizeMaskOverlaySettings } from './maskOverlayModes';
import { toMaskParameterRecord } from './maskParameterAccess';

type SerializableMaskParameters = Record<string, unknown> & {
  mask_data_base64?: string | null | undefined;
  maskDataBase64?: string | null | undefined;
};

export type MaskPreviewDefinition =
  | (Omit<MaskContainer, 'adjustments'> & { adjustments: Partial<Adjustments> })
  | (AiPatch & { adjustments?: Partial<Adjustments>; opacity?: number });

export interface MaskOverlayInvokePayload {
  cropOffset: [number, number];
  editDocumentV2: EditDocumentV2;
  height: number;
  maskDef: MaskPreviewDefinition;
  overlaySettings: MaskOverlaySettings;
  scale: number;
  width: number;
}

export interface BuildMaskOverlayInvokePayloadParams {
  editDocumentV2: EditDocumentV2;
  maskDef: MaskPreviewDefinition;
  maskOverlaySettings: MaskOverlaySettings;
  patchesSentToBackend: ReadonlySet<string>;
  renderSize: RenderSize;
}

export interface BuildMaskOverlayTriggerHashParams {
  activeMaskDef: MaskPreviewDefinition | undefined;
  editDocumentV2: EditDocumentV2;
  imageRenderSize: Pick<RenderSize, 'height' | 'width'>;
  maskOverlaySettings: MaskOverlaySettings;
}

export interface BuildMaskOverlayRequestIdentityParams {
  imageSessionId: string;
  renderSize: Pick<RenderSize, 'height' | 'scale' | 'width'>;
  selectedImagePath: string | null | undefined;
  triggerHash: string | null;
}

const stripBackendMaskDataFromSubMasks = (
  subMasks: Array<SubMask> | undefined,
  patchesSentToBackend: ReadonlySet<string>,
) => {
  if (!Array.isArray(subMasks)) return;

  subMasks.forEach((subMask) => {
    if (!subMask.id || !subMask.parameters || !patchesSentToBackend.has(subMask.id)) return;

    const parameters = toMaskParameterRecord(subMask.parameters);
    if (parameters['mask_data_base64'] !== undefined) parameters['mask_data_base64'] = null;
    if (parameters['maskDataBase64'] !== undefined) parameters['maskDataBase64'] = null;
    subMask.parameters = parameters;
  });
};

const stripMaskPayloadsForOverlay = <T extends EditDocumentV2 | MaskPreviewDefinition>(
  value: T,
  patchesSentToBackend: ReadonlySet<string>,
): T => {
  const clone = structuredClone(value);

  if ('layers' in clone) {
    for (const mask of clone.layers.masks) {
      stripBackendMaskDataFromSubMasks(mask.subMasks as SubMask[], patchesSentToBackend);
    }
    for (const patch of clone.sourceArtifacts.aiPatches) {
      stripBackendMaskDataFromSubMasks(patch.subMasks as SubMask[], patchesSentToBackend);
    }
  }

  const subMasks = 'subMasks' in clone ? clone.subMasks : undefined;
  if (Array.isArray(subMasks)) {
    stripBackendMaskDataFromSubMasks(subMasks, patchesSentToBackend);
  }

  return clone;
};

export const buildMaskOverlayInvokePayload = ({
  editDocumentV2,
  maskDef,
  maskOverlaySettings,
  patchesSentToBackend,
  renderSize,
}: BuildMaskOverlayInvokePayloadParams): MaskOverlayInvokePayload | null => {
  if (!maskDef.visible || renderSize.width === 0) return null;

  const overlaySettings = normalizeMaskOverlaySettings(maskOverlaySettings);
  if (overlaySettings.mode === 'hidden') return null;
  const crop = selectEditDocumentGeometry(editDocumentV2).crop;

  return {
    cropOffset: [crop?.x ?? 0, crop?.y ?? 0],
    editDocumentV2: stripMaskPayloadsForOverlay(editDocumentV2, patchesSentToBackend),
    height: Math.round(renderSize.height),
    maskDef: stripMaskPayloadsForOverlay(maskDef, patchesSentToBackend),
    overlaySettings,
    scale: renderSize.scale,
    width: Math.round(renderSize.width),
  };
};

export const buildMaskOverlayTriggerHash = ({
  activeMaskDef,
  editDocumentV2,
  imageRenderSize,
  maskOverlaySettings,
}: BuildMaskOverlayTriggerHashParams): string | null => {
  if (!activeMaskDef) return null;

  const geometry = selectEditDocumentGeometry(editDocumentV2);
  const lens = selectEditDocumentNode(editDocumentV2, 'lens_correction').params;

  const subMasks = activeMaskDef.subMasks.map((subMask: SubMask) => {
    const rest: Omit<SubMask, 'parameters'> = {
      id: subMask.id,
      invert: subMask.invert,
      mode: subMask.mode,
      opacity: subMask.opacity,
      type: subMask.type,
      visible: subMask.visible,
      ...(subMask.name !== undefined ? { name: subMask.name } : {}),
    };
    const cleanParams: SerializableMaskParameters = toMaskParameterRecord(subMask.parameters);
    const maskDataBase64 = cleanParams.mask_data_base64;
    const maskDataCamelBase64 = cleanParams.maskDataBase64;
    const maskDataFingerprint =
      typeof maskDataBase64 === 'string' ? `${maskDataBase64.length}-${maskDataBase64.slice(-20)}` : null;
    const maskDataCamelFingerprint =
      typeof maskDataCamelBase64 === 'string'
        ? `${maskDataCamelBase64.length}-${maskDataCamelBase64.slice(-20)}`
        : null;
    delete cleanParams.mask_data_base64;
    delete cleanParams.maskDataBase64;
    return {
      ...rest,
      parameters: cleanParams,
      _maskDataCamelFingerprint: maskDataCamelFingerprint,
      _maskDataFingerprint: maskDataFingerprint,
    };
  });

  return JSON.stringify({
    geometry,
    id: activeMaskDef.id,
    invert: activeMaskDef.invert,
    lens,
    maskOverlaySettings: normalizeMaskOverlaySettings(maskOverlaySettings),
    opacity: 'opacity' in activeMaskDef ? activeMaskDef.opacity : 100,
    renderSize: { h: imageRenderSize.height, w: imageRenderSize.width },
    subMasks,
  });
};

export const buildMaskOverlayRequestIdentity = ({
  imageSessionId,
  renderSize,
  selectedImagePath,
  triggerHash,
}: BuildMaskOverlayRequestIdentityParams): string =>
  JSON.stringify({
    imageSessionId,
    renderSize: {
      h: Math.round(renderSize.height),
      scale: Number(renderSize.scale.toFixed(4)),
      w: Math.round(renderSize.width),
    },
    selectedImagePath: selectedImagePath ?? null,
    triggerHash,
  });

export const isMaskOverlayResponseCurrent = (latestRequestIdentity: string | null, responseIdentity: string): boolean =>
  latestRequestIdentity === responseIdentity;
