import { toMaskParameterRecord } from './maskParameterAccess';
import { createSubMask } from './maskUtils';
import { Mask, type MaskType, type SubMask, SubMaskMode } from '../components/panel/right/Masks';

import type { ImageDimensions } from '../hooks/useImageRenderSize';

export interface EditorSubMaskFactoryOptions {
  faceName?: string;
  imageDimensions: ImageDimensions;
  mode?: SubMaskMode;
  orientationSteps?: number;
  personPart?: MaskType['personPart'];
  type: Mask;
}

const DEFAULT_IMAGE_DIMENSIONS: ImageDimensions = { width: 1000, height: 1000 };
const INITIAL_DRAW_SENTINEL = -10000;
const LINEAR_MASK_RANGE_FRACTION = 0.12;
const LINEAR_MASK_START_Y_FRACTION = 0.12;
const LINEAR_MASK_END_Y_FRACTION = 0.72;
const COLOR_LUMA_DEFAULT_TOLERANCE = 20;
const COLOR_LUMA_DEFAULT_FEATHER = 35;
const AI_DEPTH_MIN = 20;
const AI_DEPTH_MAX = 100;
const AI_DEPTH_FADE = 15;
const AI_DEPTH_FEATHER = 10;

export function createEditorSubMaskForImage({
  faceName,
  imageDimensions,
  mode = SubMaskMode.Additive,
  orientationSteps = 0,
  personPart,
  type,
}: EditorSubMaskFactoryOptions): SubMask {
  const sourceImage = sanitizeImageDimensions(imageDimensions);
  const subMask = createSubMask(type, sourceImage, mode);
  const { width: imageWidth, height: imageHeight } = getMaskWorkingDimensions(sourceImage, orientationSteps);
  const parameters = toMaskParameterRecord(subMask.parameters);

  if (type === Mask.Linear) {
    Object.assign(parameters, {
      imageHeight,
      imageWidth,
      range: Math.min(imageWidth, imageHeight) * LINEAR_MASK_RANGE_FRACTION,
      startX: imageWidth * 0.5,
      startY: imageHeight * LINEAR_MASK_START_Y_FRACTION,
      endX: imageWidth * 0.5,
      endY: imageHeight * LINEAR_MASK_END_Y_FRACTION,
    });
  }

  if (type === Mask.Linear || type === Mask.Radial || type === Mask.Color || type === Mask.Luminance) {
    parameters['isInitialDraw'] = true;
    if (type === Mask.Radial) {
      Object.assign(parameters, {
        startX: INITIAL_DRAW_SENTINEL,
        startY: INITIAL_DRAW_SENTINEL,
        endX: INITIAL_DRAW_SENTINEL,
        endY: INITIAL_DRAW_SENTINEL,
        centerX: INITIAL_DRAW_SENTINEL,
        centerY: INITIAL_DRAW_SENTINEL,
        radiusX: 0,
        radiusY: 0,
      });
    } else {
      Object.assign(parameters, {
        targetX: INITIAL_DRAW_SENTINEL,
        targetY: INITIAL_DRAW_SENTINEL,
        tolerance: COLOR_LUMA_DEFAULT_TOLERANCE,
        feather: COLOR_LUMA_DEFAULT_FEATHER,
      });
    }
  }

  if (type === Mask.AiDepth) {
    Object.assign(parameters, {
      minDepth: AI_DEPTH_MIN,
      maxDepth: AI_DEPTH_MAX,
      minFade: AI_DEPTH_FADE,
      maxFade: AI_DEPTH_FADE,
      feather: AI_DEPTH_FEATHER,
    });
  }

  subMask.parameters =
    personPart === undefined ? parameters : { ...parameters, target: { part: personPart, personId: null } };
  if (personPart === 'face' && faceName) subMask.name = faceName;

  return subMask;
}

export function createEditorSubMaskFallback(type: Mask, mode: SubMaskMode = SubMaskMode.Additive): SubMask {
  return createSubMask(type, DEFAULT_IMAGE_DIMENSIONS, mode);
}

function sanitizeImageDimensions(imageDimensions: ImageDimensions): ImageDimensions {
  return {
    width: imageDimensions.width || DEFAULT_IMAGE_DIMENSIONS.width,
    height: imageDimensions.height || DEFAULT_IMAGE_DIMENSIONS.height,
  };
}

function getMaskWorkingDimensions(
  imageDimensions: ImageDimensions,
  orientationSteps: number,
): { height: number; width: number } {
  const isRotated = orientationSteps === 1 || orientationSteps === 3;
  return {
    width: isRotated ? imageDimensions.height : imageDimensions.width,
    height: isRotated ? imageDimensions.width : imageDimensions.height,
  };
}
