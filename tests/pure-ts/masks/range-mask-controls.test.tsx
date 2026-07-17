import { afterEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { RangeMaskControls } from '../../../src/components/panel/right/layers/RangeMaskControls';
import { mergeMaskParameters } from '../../../src/utils/mask/maskParameterAccess';

mock.module('@clerk/react', () => ({
  useAuth: () => ({ getToken: async () => null }),
  useUser: () => ({ isSignedIn: false, user: null }),
}));

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: {} } } });

const renderRange = (
  kind: 'color' | 'luminance',
  callbacks: { apply: ReturnType<typeof mock>; preview: ReturnType<typeof mock> },
) =>
  render(
    <I18nextProvider i18n={i18n}>
      <RangeMaskControls
        kind={kind}
        parameters={
          kind === 'color'
            ? {
                centerHueDegrees: 24,
                feather: 0.2,
                hueToleranceDegrees: 32,
                maxLuma: 0.9,
                maxSaturation: 1,
                minLuma: 0.1,
                minSaturation: 0.1,
                rangeKind: 'color',
                smoothness: 0.3,
              }
            : { feather: 0.2, maxLuma: 0.9, minLuma: 0.1, rangeKind: 'luminance', smoothness: 0.3 }
        }
        onApply={callbacks.apply}
        onPreview={callbacks.preview}
      />
    </I18nextProvider>,
  );

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Lightroom range mask controls', () => {
  test('keeps typed color bounds ordered and emits preview/apply payloads', () => {
    const callbacks = { apply: mock(), preview: mock() };
    const view = renderRange('color', callbacks);
    const min = view.getByLabelText('Range minimum');
    fireEvent.change(min, { target: { value: '85' } });
    fireEvent.click(view.getByTestId('range-mask-preview-color'));
    expect(callbacks.preview).toHaveBeenCalledTimes(1);
    const preview = callbacks.preview.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(preview['rangeKind']).toBe('color');
    expect(preview['minLuma']).toBeLessThan(preview['maxLuma'] as number);
    fireEvent.click(view.getByTestId('range-mask-apply-color'));
    expect(callbacks.apply).toHaveBeenCalledTimes(1);
  });

  test('cancel restores the committed luminance draft after a preview', () => {
    const callbacks = { apply: mock(), preview: mock() };
    const view = renderRange('luminance', callbacks);
    fireEvent.change(view.getByLabelText('Range feather'), { target: { value: '88' } });
    fireEvent.click(view.getByTestId('range-mask-preview-luminance'));
    fireEvent.click(view.getByTestId('range-mask-cancel-luminance'));
    const restored = callbacks.preview.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(restored['feather']).toBe(0.2);
    expect(restored['smoothness']).toBe(0.3);
  });

  test('normalizes picker-era feather percentages without dropping sampled metadata', () => {
    const callbacks = { apply: mock(), preview: mock() };
    const view = render(
      <I18nextProvider i18n={i18n}>
        <RangeMaskControls
          kind="luminance"
          parameters={{
            feather: 35,
            isInitialDraw: false,
            targetX: 812,
            targetY: 426,
            tolerance: 20,
          }}
          onApply={callbacks.apply}
          onPreview={callbacks.preview}
        />
      </I18nextProvider>,
    );

    expect((view.getByLabelText('Range feather') as HTMLInputElement).value).toBe('35');
    fireEvent.click(view.getByTestId('range-mask-apply-luminance'));
    const selection = callbacks.apply.mock.calls[0]?.[0] as Record<string, unknown>;
    const merged = mergeMaskParameters({ isInitialDraw: false, targetX: 812, targetY: 426, tolerance: 20 }, selection);
    expect(merged).toMatchObject({ isInitialDraw: false, targetX: 812, targetY: 426, tolerance: 20 });
    expect(merged['feather']).toBe(0.35);
  });
});
