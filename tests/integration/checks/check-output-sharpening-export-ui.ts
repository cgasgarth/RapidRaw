#!/usr/bin/env bun

import { mock } from 'bun:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Theme } from '../../../src/components/ui/AppProperties.tsx';
import { type ExportSettings, Status } from '../../../src/components/ui/ExportImportProperties.ts';
import { Invokes } from '../../../src/tauri/commands.ts';

type RenderedPanel = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
};

type InvokeCall = {
  args: Record<string, unknown>;
  command: string;
};

const failures: string[] = [];
const invokeCalls: InvokeCall[] = [];

mock.module('@tauri-apps/api/core', () => ({
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    invokeCalls.push({ args, command });
    if (command === Invokes.EstimateExportSizes) return 1_234_567;
    if (command === Invokes.GetExportColorCapabilities) return {};
    if (command === Invokes.ExportImages) return null;
    return null;
  },
}));
mock.module('@tauri-apps/plugin-dialog', () => ({
  open: () => null,
  save: () => '/tmp/rapidraw-output-sharpening/exported.jpg',
}));
mock.module('@tauri-apps/plugin-os', () => ({
  platform: () => 'macos',
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const { default: ExportPanel } = await import('../../../src/components/panel/right/ExportPanel.tsx');

await validateLocaleContract();
await validateRenderedOutputSharpeningBehavior();

if (failures.length > 0) {
  console.error('output sharpening export UI failed');
  console.error(failures.slice(0, 12).join('\n'));
  process.exit(1);
}

console.log('output sharpening export UI ok');

async function validateLocaleContract() {
  const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')) as {
    export?: {
      outputSharpening?: { targets?: Record<string, string> } & Record<string, unknown>;
      readiness?: Record<string, unknown>;
      sections?: Record<string, unknown>;
    };
  };
  const requiredKeys = [
    locale.export?.sections?.outputSharpening,
    locale.export?.outputSharpening?.enable,
    locale.export?.outputSharpening?.amount,
    locale.export?.outputSharpening?.radius,
    locale.export?.outputSharpening?.threshold,
    locale.export?.outputSharpening?.targets?.screen,
    locale.export?.outputSharpening?.targets?.print,
    locale.export?.outputSharpening?.targets?.custom,
    locale.export?.readiness?.outputSharpeningOn,
    locale.export?.readiness?.outputSharpeningOff,
  ];

  for (const key of requiredKeys) {
    if (typeof key !== 'string' || key.length === 0) failures.push('Missing output sharpening locale key.');
  }
}

async function validateRenderedOutputSharpeningBehavior() {
  const rendered = await renderExportPanel();

  await waitForText(rendered.container, 'No output sharpening', 'initial readiness did not show disabled state.');

  const enableSwitch = getByLabel<HTMLInputElement>(rendered.container, 'Apply output sharpening');
  await changeInput(enableSwitch, true);
  await waitForText(rendered.container, 'Output sharpen screen', 'readiness did not show enabled screen target.');

  assert.equal(getByLabel<HTMLInputElement>(rendered.container, 'Amount').value, '35');
  assert.equal(getByLabel<HTMLInputElement>(rendered.container, 'Radius').value, '0.7');
  assert.equal(getByLabel<HTMLInputElement>(rendered.container, 'Threshold').value, '2');

  await selectDropdownOption(rendered.container, 'Screen', 'Custom');
  await waitForText(rendered.container, 'Output sharpen custom', 'readiness did not update after changing target.');

  const exportButton = Array.from(rendered.container.querySelectorAll('button')).find((button) => {
    const text = normalizeText(button.textContent);
    return text.includes('Export Image') || text.includes('Export 1 Image');
  });
  assert.ok(exportButton, 'export button was not rendered.');
  await click(exportButton);

  const exportCall = invokeCalls.findLast((call) => call.command === Invokes.ExportImages);
  if (exportCall === undefined) {
    failures.push('ExportImages was not invoked from the rendered export panel.');
    rendered.unmount();
    return;
  }

  const exportSettings = exportCall.args.exportSettings as ExportSettings | undefined;
  assert.deepEqual(
    exportSettings?.outputSharpening,
    {
      amount: 35,
      radiusPx: 0.7,
      target: 'custom',
      threshold: 0.02,
    },
    'ExportImages payload did not preserve rendered output sharpening controls.',
  );
  assert.equal(exportCall.args.outputFormat, 'jpg', 'ExportImages did not keep the selected JPEG export format.');

  rendered.unmount();
}

async function renderExportPanel(): Promise<RenderedPanel> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const i18n = await createTestI18n();

  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(ExportPanel, {
          appSettings: {
            exportPresets: [],
            lastRootPath: null,
            theme: Theme.Dark,
          },
          exportState: {
            errorMessage: '',
            progress: { current: 0, total: 0 },
            status: Status.Idle,
          },
          isVisible: true,
          multiSelectedPaths: [],
          onSettingsChange: () => undefined,
          rootPaths: ['/photos'],
          selectedImage: {
            exif: { ISO: '100' },
            height: 2400,
            isReady: true,
            originalUrl: 'blob:rawengine-original',
            path: '/photos/output-sharpening.ARW',
            thumbnailUrl: 'blob:rawengine-thumbnail',
            width: 3600,
          },
          setExportState: () => undefined,
        }),
      ),
    );
    await flushPromises();
  });

  return {
    container,
    root,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function createTestI18n() {
  const resources = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    resources: { en: { translation: resources } },
  });
  return instance;
}

function installDom() {
  const window = new Window({ url: 'http://localhost/output-sharpening-export-ui' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: window.HTMLButtonElement });
  Object.defineProperty(globalThis, 'HTMLInputElement', { configurable: true, value: window.HTMLInputElement });
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: window.MouseEvent });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: window.Event });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: window.Node });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: window.MutationObserver });
  Object.defineProperty(globalThis, 'PointerEvent', { configurable: true, value: window.PointerEvent ?? window.Event });
}

function getByLabel<T extends HTMLElement>(container: Element, label: string): T {
  const element = container.querySelector(
    `[aria-label="${label}"], #switch-${label.replace(/\s+/g, '-').toLowerCase()}`,
  );
  assert.ok(element, `missing labelled control: ${label}`);
  return element as T;
}

async function changeInput(input: HTMLInputElement, checked: boolean) {
  await act(async () => {
    if (input.checked !== checked) {
      input.click();
    }
    await flushPromises();
  });
}

async function selectDropdownOption(container: Element, currentLabel: string, nextLabel: string) {
  const triggers = Array.from(container.querySelectorAll('button[aria-haspopup="listbox"]'));
  const trigger = triggers.find((button) => normalizeText(button.textContent).includes(currentLabel));
  assert.ok(
    trigger,
    `missing dropdown trigger: ${currentLabel}. Listboxes: ${triggers
      .map((button) => normalizeText(button.textContent))
      .join('; ')}`,
  );
  await click(trigger);

  const option = Array.from(container.querySelectorAll('button[role="option"]')).find(
    (button) => normalizeText(button.textContent) === nextLabel,
  );
  assert.ok(option, `missing dropdown option: ${nextLabel}`);
  await click(option);
}

async function click(element: Element) {
  await act(async () => {
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
      element.click();
    } else {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    await flushPromises();
  });
}

async function waitForText(container: Element, text: string, message: string) {
  await waitForCondition(message, () => normalizeText(container.textContent).includes(text));
}

async function waitForCondition(message: string, check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (check()) return;
    await act(async () => {
      await flushPromises();
    });
  }

  failures.push(message);
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
