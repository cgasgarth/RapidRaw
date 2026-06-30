import type { SliderChangeEvent } from '../ui/primitives/Slider';

export function getSliderEventNumber(event: SliderChangeEvent): number {
  return parseFloat(String(event.target.value));
}
