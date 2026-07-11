import { describe, expect, test } from 'bun:test';

import {
  type ColorWheelInteractionState,
  createColorWheelInteractionController,
  resolveColorWheelChange,
} from '../../../src/components/adjustments/ColorWheel.tsx';

describe('ColorWheel interaction ownership', () => {
  test('emits one aggregate edge for a continuous wheel interaction', () => {
    const { aggregate, controller, states } = setup();
    controller.startWheel();
    controller.startWheel();
    controller.finish();
    controller.finish();
    expect(aggregate).toEqual([true, false]);
    expect(states).toEqual([
      { sliderCount: 0, wheel: true },
      { sliderCount: 0, wheel: false },
    ]);
  });

  test('keeps aggregate activity across overlapping wheel and slider ownership', () => {
    const { aggregate, controller } = setup();
    controller.startWheel();
    controller.setSlider('hue', true);
    controller.finish();
    controller.setSlider('saturation', true);
    controller.setSlider('hue', false);
    controller.setSlider('luminance', true);
    controller.setSlider('saturation', false);
    controller.setSlider('luminance', false);
    expect(aggregate).toEqual([true, false]);
    expect(controller.getState()).toEqual({ sliderCount: 0, wheel: false });
  });

  test('deduplicates repeated Slider callbacks and rapid transfer among all controls', () => {
    const { aggregate, controller, states } = setup();
    controller.setSlider('hue', true);
    controller.setSlider('hue', true);
    controller.setSlider('saturation', true);
    controller.setSlider('hue', false);
    controller.setSlider('luminance', true);
    controller.setSlider('saturation', false);
    controller.setSlider('luminance', false);
    controller.setSlider('luminance', false);
    expect(aggregate).toEqual([true, false]);
    expect(states.map(({ sliderCount }) => sliderCount)).toEqual([1, 2, 1, 2, 1, 0]);
  });

  test('unmount disposal releases the parent exactly once and ignores late child cleanup', () => {
    const { aggregate, controller } = setup();
    controller.startWheel();
    controller.setSlider('hue', true);
    controller.dispose();
    controller.dispose();
    controller.finish();
    controller.setSlider('hue', false);
    expect(aggregate).toEqual([true, false]);
    expect(controller.getState()).toEqual({ sliderCount: 0, wheel: false });
  });

  test('reactivates after a development lifecycle cleanup without reviving stale activity', () => {
    const { aggregate, controller } = setup();
    controller.startWheel();
    controller.dispose();
    controller.activate();
    controller.startWheel();
    controller.finish();
    expect(aggregate).toEqual([true, false, true, false]);
  });

  test('preserves Ctrl hue and Shift saturation constraints', () => {
    const value = { hue: 40, luminance: 12, saturation: 60 };
    expect(resolveColorWheelChange(value, 120, 90, { ctrl: true, shift: false })).toEqual({
      hue: 120,
      luminance: 12,
      saturation: 60,
    });
    expect(resolveColorWheelChange(value, 45, 110, { ctrl: false, shift: true })).toEqual({
      hue: 40,
      luminance: 12,
      saturation: 100,
    });
    expect(resolveColorWheelChange(value, 90, 75, { ctrl: false, shift: true })).toEqual({
      hue: 40,
      luminance: 12,
      saturation: 0,
    });
    expect(resolveColorWheelChange(value, 120, 90, { ctrl: false, shift: false })).toEqual({
      hue: 120,
      luminance: 12,
      saturation: 90,
    });
  });
});

function setup() {
  const aggregate: boolean[] = [];
  const states: ColorWheelInteractionState[] = [];
  const controller = createColorWheelInteractionController(
    (state) => states.push(state),
    (active) => aggregate.push(active),
  );
  return { aggregate, controller, states };
}
