import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { HdrModal } from '../../../src/components/modals/computational-merge/HdrModal.tsx';
import { PanoramaModal } from '../../../src/components/modals/computational-merge/PanoramaModal.tsx';
import { DEFAULT_HDR_MERGE_UI_SETTINGS } from '../../../src/schemas/computational-merge/hdrMergeUiSchemas.ts';
import { DEFAULT_PANORAMA_UI_SETTINGS } from '../../../src/schemas/computational-merge/panoramaUiSchemas.ts';
import {
  buildMergeOperationId,
  buildMergeSourceIdentity,
  isMergeOperationActive,
  orderedMergeSourcesMatch,
} from '../../../src/utils/computational-merge/mergeOperationIdentity.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (mounted !== null) {
    act(() => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
});

test('merge operation identities preserve ordered opaque paths and active-session guards', () => {
  const paths = ['/fixtures/Ålesund/frame 01.ARW', 'C:\\fixtures\\frame 02.ARW'];
  expect(buildMergeSourceIdentity(paths)).toBe(JSON.stringify(paths));
  expect(buildMergeOperationId('hdr', paths, 2)).not.toBe(buildMergeOperationId('hdr', paths, 3));
  expect(buildMergeOperationId('hdr', paths, 2)).not.toBe(buildMergeOperationId('panorama', paths, 2));
  expect(orderedMergeSourcesMatch(paths, [...paths])).toBe(true);
  expect(orderedMergeSourcesMatch(paths, [...paths].reverse())).toBe(false);
  expect(isMergeOperationActive({ activeOperationId: 'hdr:1', isOpen: true, isProcessing: true })).toBe(true);
  expect(isMergeOperationActive({ activeOperationId: null, isOpen: true, isProcessing: true })).toBe(false);
});

test('HDR same-source reopen creates a fresh keyed session', async () => {
  const view = await renderMerge((isOpen, paths) =>
    createElement(HdrModal, {
      error: null,
      finalImageBase64: null,
      imageCount: paths.length,
      isOpen,
      isProcessing: false,
      loadingImageUrl: null,
      onClose: () => {},
      onMerge: () => {},
      onOpenFile: () => {},
      onSave: async () => '/tmp/hdr.tif',
      onSettingsChange: () => {},
      progressMessage: null,
      runtimePlan: null,
      settings: DEFAULT_HDR_MERGE_UI_SETTINGS,
      sourceMetadata: undefined,
      sourcePaths: paths,
    }),
  );
  const paths = ['/hdr/a.ARW', '/hdr/b.ARW'];
  await view.render(true, paths);
  const firstId = operationId(view.container);
  await view.render(false, paths);
  await view.render(true, paths);
  expect(operationId(view.container)).not.toBe(firstId);
});

test('Panorama source changes and same-source reopen each replace the result session', async () => {
  const starts: string[] = [];
  const view = await renderMerge((isOpen, paths) =>
    createElement(PanoramaModal, {
      error: null,
      finalImageBase64: null,
      imageCount: paths.length,
      isOpen,
      isProcessing: false,
      lastApplyCommand: null,
      lastDryRunCommand: null,
      loadingImageUrl: null,
      onClose: () => {},
      onOpenFile: () => {},
      onSave: async () => '/tmp/panorama.tif',
      onSettingsChange: () => {},
      onStitch: (operationId) => starts.push(operationId),
      progressMessage: null,
      renderedReview: null,
      runtimePlan: null,
      settings: DEFAULT_PANORAMA_UI_SETTINGS,
      sourcePaths: paths,
    }),
  );
  const firstPaths = ['/pano/a.ARW', '/pano/b.ARW'];
  await view.render(true, firstPaths);
  const firstId = operationId(view.container);
  await view.render(true, ['/pano/c.ARW', '/pano/d.ARW']);
  const changedSourceId = operationId(view.container);
  expect(changedSourceId).not.toBe(firstId);

  await view.render(false, firstPaths);
  await view.render(true, firstPaths);
  expect(operationId(view.container)).not.toBe(firstId);
  const start = requiredButton(view.container);
  await act(async () => {
    start.click();
    start.click();
  });
  expect(starts).toHaveLength(1);
});

test('a save completing after HDR reopen cannot publish its old output path into the new session', async () => {
  let resolveSave: ((path: string) => void) | undefined;
  const save = new Promise<string>((resolve) => {
    resolveSave = resolve;
  });
  const paths = ['/hdr/late-a.ARW', '/hdr/late-b.ARW'];
  const view = await renderMerge((isOpen, sourcePaths) =>
    createElement(HdrModal, {
      error: null,
      finalImageBase64: 'data:image/png;base64,AA==',
      imageCount: sourcePaths.length,
      isOpen,
      isProcessing: false,
      loadingImageUrl: null,
      onClose: () => {},
      onMerge: () => {},
      onOpenFile: () => {},
      onSave: () => save,
      onSettingsChange: () => {},
      progressMessage: null,
      runtimePlan: null,
      settings: DEFAULT_HDR_MERGE_UI_SETTINGS,
      sourceMetadata: undefined,
      sourcePaths,
    }),
  );
  await view.render(true, paths);
  const buttons = [...view.container.querySelectorAll('button')];
  const saveButton = buttons.at(-1);
  if (saveButton === undefined) throw new Error('Expected HDR save button.');
  await act(async () => saveButton.click());
  await view.render(false, paths);
  await view.render(true, paths);
  await act(async () => {
    resolveSave?.('/tmp/old-session-hdr.tif');
    await save;
    await Promise.resolve();
  });
  expect(view.container.querySelector('[data-testid="merge-saved-output-detail"]')).toBeNull();
  expect(view.container.querySelector('[data-open-target-path="/tmp/old-session-hdr.tif"]')).toBeNull();
});

async function renderMerge(factory: (isOpen: boolean, paths: string[]) => React.ReactElement) {
  installDom();
  const translations = i18next.createInstance();
  await translations.use(initReactI18next).init({ lng: 'en', resources: {}, react: { useSuspense: false } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = async (isOpen: boolean, paths: string[]) => {
    await act(async () => {
      root.render(createElement(I18nextProvider, { i18n: translations }, factory(isOpen, paths)));
      await Promise.resolve();
    });
  };
  mounted = { container, root };
  return { container, render };
}

function operationId(container: Element) {
  const modal = container.querySelector<HTMLElement>('[data-merge-operation-id]');
  if (modal === null) throw new Error('Expected keyed merge session.');
  return modal.dataset.mergeOperationId ?? '';
}

function requiredButton(container: Element) {
  const button = container.querySelector<HTMLButtonElement>('[data-testid="merge-start-action"]');
  if (button === null) throw new Error('Expected merge start action.');
  return button;
}

function installDom() {
  const testWindow = new Window({ url: 'http://localhost/merge-session-test' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: testWindow.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: testWindow.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: testWindow.HTMLElement });
}
