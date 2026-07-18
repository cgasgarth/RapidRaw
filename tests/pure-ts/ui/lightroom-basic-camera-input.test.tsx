import { expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement, useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import BasicAdjustments, { type BasicAdjustmentView } from '../../../src/components/adjustments/Basic';
import { selectColorPanelAdjustmentView } from '../../../src/components/panel/right/color/ColorWorkspacePanel';
import en from '../../../src/i18n/locales/en.json';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const document = createDefaultEditDocumentV2();
const defaultBasicView = (): BasicAdjustmentView => ({
  ...selectEditDocumentNode(document, 'scene_global_color_tone').params,
  ...selectEditDocumentNode(document, 'scene_to_view_transform').params,
  ...selectEditDocumentNode(document, 'tone_equalizer').params,
});

test('Basic owns the camera-input hierarchy without duplicating Presence there', async () => {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });

  const view = render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(BasicHarness, {
        initialAdjustments: defaultBasicView(),
      }),
    ),
  );
  await act(flushPromises);

  const basic = required(view.container, '[data-testid="basic-light-controls"]');
  const treatment = required(basic, '[data-testid="basic-treatment"]');
  const profile = required<HTMLElement>(basic, '[data-testid="profile-tone-controls"]');
  const whiteBalance = required<HTMLElement>(basic, '[data-testid="color-quick-white-balance"]');

  expect(treatment.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(profile.compareDocumentPosition(whiteBalance) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(profile.querySelector('select[aria-label="Tone Curve"]')).toBeNull();
  expect(basic.querySelector('[data-testid="color-quick-presence"]')).toBeNull();
  expect(whiteBalance.querySelector('[data-testid="color-white-balance-mode"]')).not.toBeNull();
  expect(whiteBalance.querySelector('[data-testid="color-white-balance-picker"]')).not.toBeNull();
  expect(whiteBalance.dataset['whiteBalanceSyncMode']).toBe('per_image');
  expect(whiteBalance.dataset['whiteBalanceReferenceSource']).toBe('');
  expect(treatment.querySelector('[role="radio"]')?.textContent).toContain('Color');

  view.unmount();
});

function BasicHarness({ initialAdjustments }: { initialAdjustments: BasicAdjustmentView }) {
  const [adjustments, setAdjustments] = useState(initialAdjustments);
  return createElement(BasicAdjustments, {
    adjustments,
    appSettings: { useWgpuRenderer: false },
    cameraInputAdjustments: selectColorPanelAdjustmentView(document),
    isWbPickerActive: false,
    toggleWbPicker: () => undefined,
    setAdjustments: (update) => {
      setAdjustments((previous) => (typeof update === 'function' ? update(previous) : { ...previous, ...update }));
    },
  });
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
