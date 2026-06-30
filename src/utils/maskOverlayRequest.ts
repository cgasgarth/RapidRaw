import type { SubMask } from '../components/panel/right/Masks';
import type { RenderSize } from '../hooks/viewport/useImageRenderSize';
import type { MaskOverlaySettings } from '../schemas/masks/maskOverlaySchemas';
import type { Adjustments, AiPatch, MaskContainer } from './adjustments';
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
  height: number;
  jsAdjustments: Adjustments;
  maskDef: MaskPreviewDefinition;
  overlaySettings: MaskOverlaySettings;
  scale: number;
  width: number;
}

export interface BuildMaskOverlayInvokePayloadParams {
  jsAdjustments: Adjustments;
  maskDef: MaskPreviewDefinition;
  maskOverlaySettings: MaskOverlaySettings;
  patchesSentToBackend: ReadonlySet<string>;
  renderSize: RenderSize;
}

export interface BuildMaskOverlayTriggerHashParams {
  activeMaskDef: AiPatch | MaskContainer | undefined;
  adjustments: Adjustments;
  imageRenderSize: Pick<RenderSize, 'height' | 'width'>;
  maskOverlaySettings: MaskOverlaySettings;
}

const MASK_OVERLAY_GEOMETRY_KEYS = [
  'crop',
  'rotation',
  'flipHorizontal',
  'flipVertical',
  'orientationSteps',
  'transformDistortion',
  'transformVertical',
  'transformHorizontal',
  'transformRotate',
  'transformAspect',
  'transformScale',
  'transformXOffset',
  'transformYOffset',
  'lensDistortionAmount',
  'lensVignetteAmount',
  'lensTcaAmount',
  'lensDistortionParams',
  'lensMaker',
  'lensModel',
  'lensDistortionEnabled',
  'lensTcaEnabled',
  'lensVignetteEnabled',
] as const satisfies ReadonlyArray<keyof Adjustments>;

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

export const stripMaskPayloadsForOverlay = <T extends MaskPreviewDefinition | Adjustments>(
  value: T,
  patchesSentToBackend: ReadonlySet<string>,
): T => {
  const clone = structuredClone(value);

  if ('masks' in clone) {
    clone.masks.forEach((mask) => {
      stripBackendMaskDataFromSubMasks(mask.subMasks, patchesSentToBackend);
    });
  }

  if ('aiPatches' in clone) {
    clone.aiPatches.forEach((patch) => {
      stripBackendMaskDataFromSubMasks(patch.subMasks, patchesSentToBackend);
    });
  }

  const subMasks = 'subMasks' in clone ? clone.subMasks : undefined;
  if (Array.isArray(subMasks)) {
    stripBackendMaskDataFromSubMasks(subMasks, patchesSentToBackend);
  }

  return clone;
};

export const buildMaskOverlayInvokePayload = ({
  jsAdjustments,
  maskDef,
  maskOverlaySettings,
  patchesSentToBackend,
  renderSize,
}: BuildMaskOverlayInvokePayloadParams): MaskOverlayInvokePayload | null => {
  if (!maskDef.visible || renderSize.width === 0) return null;

  const overlaySettings = normalizeMaskOverlaySettings(maskOverlaySettings);
  if (overlaySettings.mode === 'hidden') return null;

  return {
    cropOffset: [jsAdjustments.crop?.x || 0, jsAdjustments.crop?.y || 0],
    height: Math.round(renderSize.height),
    jsAdjustments: stripMaskPayloadsForOverlay(jsAdjustments, patchesSentToBackend),
    maskDef: stripMaskPayloadsForOverlay(maskDef, patchesSentToBackend),
    overlaySettings,
    scale: renderSize.scale,
    width: Math.round(renderSize.width),
  };
};

export const buildMaskOverlayTriggerHash = ({
  activeMaskDef,
  adjustments,
  imageRenderSize,
  maskOverlaySettings,
}: BuildMaskOverlayTriggerHashParams): string | null => {
  if (!activeMaskDef) return null;

  const geometry: Partial<Record<keyof Adjustments, unknown>> = {};
  MASK_OVERLAY_GEOMETRY_KEYS.forEach((key) => {
    geometry[key] = adjustments[key];
  });

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
    maskOverlaySettings: normalizeMaskOverlaySettings(maskOverlaySettings),
    opacity: 'opacity' in activeMaskDef ? activeMaskDef.opacity : 100,
    renderSize: { h: imageRenderSize.height, w: imageRenderSize.width },
    subMasks,
  });
};
