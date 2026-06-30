import type { ReactNode } from 'react';
import Slider from '../ui/primitives/Slider';
import { getSliderEventNumber } from './adjustmentSliderValue';

export interface AdjustmentSliderProps {
  label: ReactNode;
  max: number;
  min: number;
  onDragStateChange?: ((isDragging: boolean) => void) | undefined;
  onValueChange: (value: number) => void;
  step: number;
  value: number;
  defaultValue?: number;
  disabled?: boolean;
  fillOrigin?: 'default' | 'min';
  suffix?: string;
  trackClassName?: string;
}

export default function AdjustmentSlider({ onValueChange, ...props }: AdjustmentSliderProps) {
  return (
    <Slider
      {...props}
      onChange={(event) => {
        onValueChange(getSliderEventNumber(event));
      }}
    />
  );
}
