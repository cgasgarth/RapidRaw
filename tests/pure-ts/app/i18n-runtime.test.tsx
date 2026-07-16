import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useTranslation } from 'react-i18next';

import i18n from '../../../src/i18n';

const waitForInitialization = async (): Promise<void> => {
  if (i18n.isInitialized) return;
  await new Promise<void>((resolve) => {
    i18n.on('initialized', () => resolve());
  });
};

const WindowCloseLabel = () => {
  const { t } = useTranslation();
  return createElement('span', null, t('window.titleBar.close'));
};

let initialLanguage = 'en';

beforeAll(async () => {
  await waitForInitialization();
  initialLanguage = i18n.language;
});

afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

describe('application i18n runtime', () => {
  test('loads real locale resources and renders them through the React binding', async () => {
    await i18n.changeLanguage('de');

    expect(i18n.t('window.titleBar.close')).toBe('Fenster schliessen');
    expect(renderToStaticMarkup(createElement(WindowCloseLabel))).toBe('<span>Fenster schliessen</span>');

    await i18n.changeLanguage('en');
    expect(i18n.t('window.titleBar.close')).toBe('Close window');
    expect(renderToStaticMarkup(createElement(WindowCloseLabel))).toBe('<span>Close window</span>');
  });
});
