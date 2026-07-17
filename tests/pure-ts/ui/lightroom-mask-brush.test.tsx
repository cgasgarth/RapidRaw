import { describe, expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { BrushMaskControls } from '../../../src/components/panel/editor/BrushMaskControls';
import { ToolType } from '../../../src/components/panel/right/layers/Masks';
import type { BrushSettings } from '../../../src/components/ui/AppProperties';
import en from '../../../src/i18n/locales/en.json';

const renderControls = (settings: BrushSettings, onSettingsChange: (next: BrushSettings) => void) => {
  const i18n = i18next.createInstance();
  void i18n.init({ fallbackLng: 'en', lng: 'en', resources: { en: { translation: en } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <BrushMaskControls
        settings={settings}
        onSettingsChange={(updater) => onSettingsChange(typeof updater === 'function' ? updater(settings) : updater)}
      />
    </I18nextProvider>,
  );
};

describe('Lightroom mask brush controls', () => {
  test('exposes one shared paint/erase state with size, feather, flow, and density', () => {
    const settings: BrushSettings = { density: 72, feather: 38, flow: 64, size: 80, tool: ToolType.Brush };
    let next = settings;
    const { container } = renderControls(settings, (value) => {
      next = value;
    });

    expect(container.querySelector('[data-testid="brush-mask-controls"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="brush-mask-controls"]')?.getAttribute('data-brush-flow')).toBe('64');
    expect(container.querySelector('[data-testid="brush-mask-controls"]')?.getAttribute('data-brush-density')).toBe(
      '72',
    );
    const erase = container.querySelector('[data-testid="brush-mask-tool-erase"]');
    if (erase === null) throw new Error('Erase control missing.');
    fireEvent.click(erase);
    expect(next.tool).toBe(ToolType.Eraser);
    const paint = container.querySelector('[data-testid="brush-mask-tool-paint"]');
    if (paint === null) throw new Error('Paint control missing.');
    fireEvent.click(paint);
    expect(next.tool).toBe(ToolType.Brush);
  });
});
