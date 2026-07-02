#!/usr/bin/env bun

import { mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { Invokes } from '../../../../src/tauri/commands.ts';

mock.module('@tauri-apps/api/core', () => ({
  invoke: mock((command: string) => {
    if (command === Invokes.GeneratePreviewForPath) return Promise.resolve(new Uint8Array([1, 2, 3]));
    if (command === Invokes.RenderNegativeLabDryRunPreviewArtifact) {
      return Promise.resolve({
        artifactId: 'artifact_negative_lab_runtime_preview_test',
        baseFogSampleSummary: {
          clippedFraction: 0,
          confidence: 0.81,
          densityRange: 0.07,
          densityRgb: {
            b: 0.55,
            g: 0.51,
            r: 0.48,
          },
          meanRgb: {
            b: 0.2818,
            g: 0.309,
            r: 0.3311,
          },
          sampleCount: 400,
          sampleRect: {
            height: 0.6,
            width: 0.12,
            x: 0.02,
            y: 0.2,
          },
          source: 'deterministic_edge_safe_default_rect',
          warningCodes: [],
        },
        contentHash: 'sha256:8a5edab282632443219e051e301c8f382f0f0f8b80636cae5f0204f20795d880',
        dimensions: { height: 1, width: 1 },
        previewDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==',
        renderer: 'rawengine_negative_lab_runtime_preview_v1',
        storage: 'temp_cache',
      });
    }
    if (command === Invokes.PreviewNegativeConversion) {
      return Promise.resolve('data:image/png;base64,iVBORw0KGgo=');
    }
    return Promise.resolve(null);
  }),
}));

mock.module('@tauri-apps/api/event', () => ({
  listen: mock(() => Promise.resolve(() => undefined)),
}));

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const i18n = await createTestI18n(locale);
const failures: string[] = [];

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const { NegativeConversionModal } = await import(
  '../../../../src/components/modals/negative-lab/NegativeConversionModal.tsx'
);

const rendered = await renderNegativeLabModal();

assertRoleName('dialog', locale.modals.negativeConversion.title);
assertRoleName('button', locale.modals.negativeConversion.convertAndSaveAll.replace('{{count}}', '2'));
assertRoleName('button', locale.modals.negativeConversion.cancel);
assertRoleName('button', locale.modals.negativeConversion.resetTooltip);

assertRoleName('button', locale.modals.negativeConversion.zoomOutTooltip);
assertRoleName('button', locale.modals.negativeConversion.zoomInTooltip);
assertRoleName('button', locale.modals.negativeConversion.resetViewTooltip);
assertRoleName('button', locale.modals.negativeConversion.compareTooltip);

assertRoleName('group', locale.modals.negativeConversion.baseFogSample);
assertRoleName('button', locale.modals.negativeConversion.sampleLeftEdge);
assertRoleName('button', locale.modals.negativeConversion.sampleCenterPatch);
assertRoleName('group', locale.modals.negativeConversion.baseSamplingStudio);
assertRoleName('button', locale.modals.negativeConversion.acceptBaseSample);
assertRoleName('button', locale.modals.negativeConversion.rejectBaseSample);

assertRoleName('combobox', locale.modals.negativeConversion.acquisitionProfile);
assertRoleName('combobox', locale.modals.negativeConversion.profileSort);
assertRoleName('tablist', locale.modals.negativeConversion.profileSearch);
assertRoleName('tab', locale.modals.negativeConversion.profileFilterAll);
assertRoleName('group', locale.modals.negativeConversion.genericPresets);
assertRoleName('button', 'C-41 Neutral');

assertRoleName('region', locale.modals.negativeConversion.frameHealth);
assertRoleName('status', locale.modals.negativeConversion.batchReadiness);
assertRoleName('group', locale.modals.negativeConversion.frameHealth);
assertRoleName('button', 'scan-1.dng');
assertRoleName('combobox', locale.modals.negativeConversion.frameHealthSeverityFilter);
assertRoleName('combobox', locale.modals.negativeConversion.frameHealthSort);

assertRoleName('region', locale.modals.negativeConversion.scanInputGuidanceTitle);
assertRoleName('status', locale.modals.negativeConversion.acquisitionHealth);
assertRoleName('status', locale.modals.negativeConversion.walkthroughClosureTitle);
assertRoleName('status', locale.modals.negativeConversion.agentActivity);
assertRoleName('region', locale.modals.negativeConversion.dustScratchReview);

if (failures.length > 0) {
  console.error('negative lab modal a11y controls failed');
  console.error(failures.join('\n'));
  rendered.unmount();
  process.exit(1);
}

rendered.unmount();
console.log('negative lab modal a11y controls ok');

async function renderNegativeLabModal(): Promise<{ container: HTMLDivElement; root: Root; unmount: () => void }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(NegativeConversionModal, {
          isOpen: true,
          onClose: () => undefined,
          onSave: () => undefined,
          targetPaths: ['/roll/scan-1.dng', '/roll/scan-2.dng'],
        }),
      ),
    );
    await flushTimers();
  });

  await act(async () => {
    await flushTimers();
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

function assertRoleName(role: string, expectedName: string) {
  const found = getByRoleName(role, expectedName);
  if (found === null) {
    failures.push(`Expected accessible ${role} named "${expectedName}".`);
  }
}

function getByRoleName(role: string, expectedName: string): Element | null {
  const normalizedExpected = normalizeText(expectedName);
  for (const element of roleCandidates(role)) {
    const actualName = accessibleName(element);
    if (actualName.includes(normalizedExpected)) return element;
  }
  return null;
}

function roleCandidates(role: string): Element[] {
  const explicit = [...document.querySelectorAll(`[role="${cssEscape(role)}"]`)];
  if (role === 'button') return [...explicit, ...document.querySelectorAll('button')];
  if (role === 'combobox') return [...explicit, ...document.querySelectorAll('select')];
  return explicit;
}

function accessibleName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel !== null) return normalizeText(ariaLabel);

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy !== null) {
    return normalizeText(
      labelledBy
        .split(/\s+/u)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' '),
    );
  }

  return normalizeText(element.textContent ?? '');
}

function normalizeText(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

function cssEscape(value: string) {
  return value.replace(/["\\]/gu, '\\$&');
}

function installDom() {
  const window = new Window({ pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, {
    Blob: window.Blob,
    document: window.document,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLImageElement: window.HTMLImageElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLSelectElement: window.HTMLSelectElement,
    MouseEvent: window.MouseEvent,
    navigator: window.navigator,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    URL: window.URL,
    window,
  });
}

async function flushTimers() {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

async function createTestI18n(resources: typeof locale) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: resources } },
  });
  return instance;
}
