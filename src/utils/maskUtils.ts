import { Mask, type SubMask, SubMaskMode, formatMaskTypeName } from '../components/panel/right/Masks';

import type { ImageDimensions } from '../hooks/useImageRenderSize';

export const createSubMask = (
  type: Mask,
  imageDimensions: ImageDimensions,
  mode: SubMaskMode = SubMaskMode.Additive,
): SubMask => {
  const { width, height } = imageDimensions;
  const common = {
    id: crypto.randomUUID(),
    visible: true,
    invert: false,
    opacity: 100,
    mode,
    name: formatMaskTypeName(type),
    type,
  };

  switch (type) {
    case Mask.Radial:
      return {
        ...common,
        parameters: {
          centerX: width / 2,
          centerY: height / 2,
          radiusX: width / 4,
          radiusY: width / 4,
          rotation: 0,
          feather: 0.5,
        },
      };
    case Mask.Linear:
      return {
        ...common,
        parameters: { startX: width * 0.25, startY: height / 2, endX: width * 0.75, endY: height / 2, range: 50 },
      };
    case Mask.Brush:
      return { ...common, parameters: { lines: [] } };
    case Mask.Flow:
      return { ...common, parameters: { lines: [], flow: 10 } };
    case Mask.AiSubject:
      return { ...common, parameters: { maskDataBase64: null, grow: 0, feather: 0 } };
    case Mask.AiForeground:
      return { ...common, parameters: { maskDataBase64: null, grow: 0, feather: 0 } };
    case Mask.AiObject:
      return {
        ...common,
        parameters: { boxPrompt: null, generatedPreviewStrokes: [], pointPrompts: [], providerStatus: 'empty' },
      };
    case Mask.QuickEraser:
      return { ...common, parameters: { maskDataBase64: null, grow: 50, feather: 50 } };
    case Mask.AiDepth:
    case Mask.AiSky:
    case Mask.All:
    case Mask.Color:
    case Mask.Luminance:
      return { ...common, parameters: {} };
  }
};
