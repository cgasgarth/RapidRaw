declare module 'react-image-crop' {
  import type { CSSProperties, PureComponent, ReactNode } from 'react';

  export type XOrds = 'e' | 'w';
  export type YOrds = 'n' | 's';
  export type XYOrds = 'nw' | 'ne' | 'se' | 'sw';
  export type Ords = XOrds | YOrds | XYOrds;

  export interface Crop {
    x: number;
    y: number;
    width: number;
    height: number;
    unit?: 'px' | '%';
  }

  export interface PixelCrop extends Crop {
    unit: 'px';
  }

  export interface PercentCrop extends Crop {
    unit: '%';
  }

  export interface ReactCropState {
    cropIsActive: boolean;
    newCropIsBeingDrawn: boolean;
  }

  export interface ReactCropProps {
    ariaLabels?: {
      cropArea: string;
      nwDragHandle: string;
      nDragHandle: string;
      neDragHandle: string;
      eDragHandle: string;
      seDragHandle: string;
      sDragHandle: string;
      swDragHandle: string;
      wDragHandle: string;
    };
    aspect?: number | null;
    circularCrop?: boolean;
    className?: string;
    children?: ReactNode;
    crop?: Crop | null;
    disabled?: boolean;
    keepSelection?: boolean;
    locked?: boolean;
    maxHeight?: number;
    maxWidth?: number;
    minHeight?: number;
    minWidth?: number;
    onChange: (crop: PixelCrop, percentageCrop: PercentCrop) => void;
    onComplete?: (crop: PixelCrop, percentageCrop: PercentCrop) => void;
    onDragEnd?: (e: PointerEvent) => void;
    onDragStart?: (e: PointerEvent) => void;
    renderSelectionAddon?: (state: ReactCropState) => ReactNode;
    ruleOfThirds?: boolean;
    style?: CSSProperties;
  }

  export class ReactCrop extends PureComponent<ReactCropProps, ReactCropState> {}

  export { ReactCrop as Component };
  export default ReactCrop;
}

declare module 'react-image-crop/dist/ReactCrop.css';
declare module '*.css';
