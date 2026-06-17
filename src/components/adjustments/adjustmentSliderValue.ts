import type { SliderChangeEvent } from '../ui/Slider';

export function getSliderEventNumber(event: SliderChangeEvent): number {
  return parseFloat(String(event.target.value));
}
