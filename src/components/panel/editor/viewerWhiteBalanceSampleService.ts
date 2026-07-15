import {
  analyzeWhiteBalancePickerRgbaSample,
  type WhiteBalancePickerPatchSample,
  type WhiteBalancePickerSampleCoordinates,
} from '../../../utils/whiteBalancePicker';
import type { ViewerWhiteBalanceInteractionRequest } from './viewerWhiteBalanceInteractionController';

export interface ViewerWhiteBalancePatchResult extends WhiteBalancePickerPatchSample {
  readonly coordinates: WhiteBalancePickerSampleCoordinates;
}

export type ViewerWhiteBalanceSampleService = (
  request: ViewerWhiteBalanceInteractionRequest,
) => Promise<ViewerWhiteBalancePatchResult | null>;

export const sampleViewerWhiteBalancePatch: ViewerWhiteBalanceSampleService = async (request) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'Anonymous';
    image.onerror = () => reject(new Error('white_balance_picker_preview_load_failed'));
    image.onload = () => {
      const radius = 5;
      const side = radius * 2 + 1;
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) {
        resolve(null);
        return;
      }

      const scaleX = image.width / request.cropSize.width;
      const scaleY = image.height / request.cropSize.height;
      const previewPixelX = Math.floor(request.imagePoint.x * scaleX);
      const previewPixelY = Math.floor(request.imagePoint.y * scaleY);
      const startX = Math.max(0, previewPixelX - radius);
      const startY = Math.max(0, previewPixelY - radius);
      const endX = Math.min(image.width, previewPixelX + radius + 1);
      const endY = Math.min(image.height, previewPixelY + radius + 1);
      const width = endX - startX;
      const height = endY - startY;
      if (width <= 0 || height <= 0) {
        resolve(null);
        return;
      }

      context.drawImage(image, startX, startY, width, height, 0, 0, width, height);
      const patch = analyzeWhiteBalancePickerRgbaSample(context.getImageData(0, 0, width, height).data);
      resolve(
        patch === null
          ? null
          : {
              ...patch,
              coordinates: {
                imageX: request.imagePoint.x,
                imageY: request.imagePoint.y,
                previewPixelX,
                previewPixelY,
              },
            },
      );
    };
    image.src = request.identity.previewIdentity;
  });
