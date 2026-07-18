import { afterEach, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement, useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { ColorMixerControls } from '../../../src/components/adjustments/color/ColorMixerControls';
import { selectColorPanelAdjustmentView } from '../../../src/components/panel/right/color/ColorWorkspacePanel';
import en from '../../../src/i18n/locales/en.json';
import type {
  BlackWhiteMixerChannel,
  BlackWhiteMixerSettings,
} from '../../../src/schemas/color/blackWhiteMixerSchemas';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import type { SelectiveColorMixerSettings } from '../../../src/utils/selectiveColorEditTransaction';

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

afterEach(() => cleanup());

test('renders HSL modes, eight channel swatches, and a distinct Color view', () => {
  const view = renderMixer();

  expect(view.getByTestId('color-mixer-view-hsl').getAttribute('aria-checked')).toBe('true');
  expect(view.getByTestId('color-mixer-mode-hue').getAttribute('aria-checked')).toBe('true');
  expect(view.getAllByTestId(/color-mixer-row-/u)).toHaveLength(8);
  expect(view.container.querySelector('[data-color-mixer-channel="reds"] span')).not.toBeNull();

  fireEvent.click(view.getByTestId('color-mixer-view-color'));
  expect(view.getByTestId('color-mixer-view-color').getAttribute('aria-checked')).toBe('true');
  expect(view.getAllByTestId(/color-mixer-row-/u)).toHaveLength(8);
  expect(view.queryByTestId('color-mixer-mode-hue')).toBeNull();
});

test('supports numeric HSL entry, edited indicators, and channel keyboard navigation', () => {
  const view = renderMixer();
  const value = view.getByTestId('color-mixer-hue-reds-value');

  fireEvent.click(value);
  const input = view.getByTestId('color-mixer-hue-reds-input');
  fireEvent.change(input, { target: { value: '-18' } });
  fireEvent.keyDown(input, { key: 'Enter' });

  expect((view.getByTestId('color-mixer-hue-reds-range') as HTMLInputElement).value).toBe('-18');
  expect(view.getByTestId('color-mixer-row-reds').getAttribute('data-edited')).toBe('true');

  const reds = view.container.querySelector('[data-color-mixer-channel="reds"]');
  const oranges = view.container.querySelector('[data-color-mixer-channel="oranges"]');
  if (!(reds instanceof HTMLButtonElement) || !(oranges instanceof HTMLButtonElement)) {
    throw new Error('Color Mixer channel buttons were not rendered.');
  }
  fireEvent.keyDown(reds, { key: 'ArrowRight' });
  expect(oranges.getAttribute('aria-selected')).toBe('true');
});

test('shows B&W Mix as the treatment-local surface and preserves the typed channel authority', () => {
  const adjustments = selectColorPanelAdjustmentView(createDefaultEditDocumentV2());
  adjustments.blackWhiteMixer = {
    ...adjustments.blackWhiteMixer,
    enabled: true,
  };
  const view = renderMixer(adjustments);

  expect(view.getByTestId('black-white-mix-controls')).toBeTruthy();
  expect(view.queryByTestId('color-mixer-view-hsl')).toBeNull();
  expect(view.getAllByTestId(/black-white-mixer-channel-/u)).toHaveLength(8);

  const contribution = view.getByTestId('black-white-mixer-contribution-range');
  fireEvent.input(contribution, { target: { value: '24' } });
  expect((contribution as HTMLInputElement).value).toBe('24');
  expect(view.getByTestId('black-white-weight').textContent).toBe('24');

  const reset = view.getByTestId('selective-color-reset-mixer') as HTMLButtonElement;
  expect(reset.disabled).toBe(false);
  fireEvent.click(reset);
  expect(view.getByTestId('black-white-weight').textContent).toBe('0');
  expect(reset.disabled).toBe(true);
});

function renderMixer(initial = selectColorPanelAdjustmentView(createDefaultEditDocumentV2())) {
  const Harness = () => {
    const [adjustments, setAdjustments] = useState(initial);
    const [activeColor, setActiveColor] = useState<BlackWhiteMixerChannel>('reds');
    const updateSelective = (update: (current: SelectiveColorMixerSettings) => SelectiveColorMixerSettings) => {
      setAdjustments((current) => {
        const next = update({
          hsl: current.hsl,
          selectiveColorRangeControls: current.selectiveColorRangeControls,
        });
        return { ...current, hsl: next.hsl, selectiveColorRangeControls: next.selectiveColorRangeControls };
      });
    };
    const updateBlackWhite = (update: (current: BlackWhiteMixerSettings) => BlackWhiteMixerSettings) => {
      setAdjustments((current) => ({ ...current, blackWhiteMixer: update(current.blackWhiteMixer) }));
    };

    return createElement(
      'div',
      null,
      createElement(ColorMixerControls, {
        activeChannelMixerOutput: 'red',
        activeColor,
        activeColorBalanceRange: 'midtones',
        adjustmentVisibility: {},
        adjustments,
        appSettings: null,
        blackWhiteMixerCommitIdentity: null,
        channelMixerCommitIdentity: null,
        commitBlackWhiteMixer: updateBlackWhite,
        commitChannelMixer: () => undefined,
        commitColorBalanceRgb: () => undefined,
        commitSelectiveColorMixer: updateSelective,
        isForMask: true,
        setActiveChannelMixerOutput: () => undefined,
        setActiveColor,
        setActiveColorBalanceRange: () => undefined,
        setAdjustments: () => undefined,
      }),
      createElement(
        'output',
        { 'data-testid': 'black-white-weight' },
        String(adjustments.blackWhiteMixer.weights.reds),
      ),
    );
  };

  return render(createElement(I18nextProvider, { i18n }, createElement(Harness)));
}
