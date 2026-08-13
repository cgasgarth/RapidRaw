import { v4 as uuidv4 } from 'uuid';
import { Mask, SubMask, SubMaskMode, SubMaskParameters, formatMaskTypeName } from '../components/panel/right/Masks';
import { ImageDimensions } from '../hooks/useImageRenderSize';

export const createSubMask = (
  type: Mask,
  imageDimensions: ImageDimensions,
  mode: SubMaskMode = SubMaskMode.Additive,
): SubMask => {
  const { width, height } = imageDimensions;
  const common = {
    id: uuidv4(),
    visible: true,
    invert: false,
    opacity: 100,
    mode,
    name: formatMaskTypeName(type),
    type,
  };

  const parameters: SubMaskParameters = (() => {
    switch (type) {
      case Mask.Radial:
        return {
          centerX: width / 2,
          centerY: height / 2,
          radiusX: width / 4,
          radiusY: width / 4,
          rotation: 0,
          feather: 0.5,
        };
      case Mask.Linear:
        return { startX: width * 0.25, startY: height / 2, endX: width * 0.75, endY: height / 2, range: 50 };
      case Mask.Brush:
        return { lines: [] };
      case Mask.Flow:
        return { lines: [], flow: 10 };
      case Mask.AiSubject:
      case Mask.AiForeground:
        return { maskDataBase64: null, grow: 0, feather: 0 };
      case Mask.QuickEraser:
        return { maskDataBase64: null, grow: 50, feather: 50 };
      default:
        return {};
    }
  })();

  return { ...common, parameters };
};
