import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

const invokeCalls: Array<{ args: unknown; command: string }> = [];
const invokeCommand = (command: string, args?: unknown) => {
  invokeCalls.push({ args, command });
  return Promise.resolve(null);
};

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();
const i18n = await createTestI18n();
const { default: CreateFolderModal } = await import('../../../src/components/modals/library/CreateFolderModal.tsx');
const { default: RenameFolderModal } = await import('../../../src/components/modals/library/RenameFolderModal.tsx');
const { default: RenameFileModal } = await import('../../../src/components/modals/library/RenameFileModal.tsx');
const { TaggingDraft } = await import('../../../src/context/TaggingSubMenu.tsx');

test('create folder cancel/reopen discards the abandoned draft and guards duplicate submission', async () => {
  const rendered = createRenderedRoot();
  const savedNames: string[] = [];
  const props = {
    isOpen: true,
    onClose: () => undefined,
    onSave: (name: string) => savedNames.push(name),
    operationScope: '/Volumes/Photo Library/Ålesund 旅行',
  };
  await render(rendered.root, createElement(CreateFolderModal, props));
  await setInputValue(rendered.container, 'create-folder-name', 'Abandoned draft');
  await render(rendered.root, createElement(CreateFolderModal, { ...props, isOpen: false }));
  await render(rendered.root, createElement(CreateFolderModal, props));
  const reopenedInput = getInput(rendered.container, 'create-folder-name');
  expect(reopenedInput.value).toBe('');

  await setInputValue(rendered.container, 'create-folder-name', '  New selects  ');
  expect(getButton(rendered.container, 'create-folder-submit').disabled).toBe(false);
  await act(async () => {
    getButton(rendered.container, 'create-folder-submit').click();
    getButton(rendered.container, 'create-folder-submit').click();
  });
  expect(savedNames).toEqual(['New selects']);
  rendered.unmount();
});

test('rename folder switches A to B synchronously and same-folder reopen gets a new draft', async () => {
  const rendered = createRenderedRoot();
  let closeCount = 0;
  const baseProps = { isOpen: true, onClose: () => closeCount++, onSave: () => undefined };
  await render(
    rendered.root,
    createElement(RenameFolderModal, {
      ...baseProps,
      currentName: 'Folder A',
      operationScope: '/library/Folder A',
    }),
  );
  await setInputValue(rendered.container, 'rename-folder-name', 'Abandoned A');
  await render(
    rendered.root,
    createElement(RenameFolderModal, {
      ...baseProps,
      currentName: 'Følder B',
      operationScope: '/library/Følder B',
    }),
  );
  expect(getInput(rendered.container, 'rename-folder-name').value).toBe('Følder B');
  await setInputValue(rendered.container, 'rename-folder-name', 'Abandoned B');
  await render(
    rendered.root,
    createElement(RenameFolderModal, {
      ...baseProps,
      currentName: 'Følder B',
      isOpen: false,
      operationScope: '/library/Følder B',
    }),
  );
  await render(
    rendered.root,
    createElement(RenameFolderModal, {
      ...baseProps,
      currentName: 'Følder B',
      operationScope: '/library/Følder B',
    }),
  );
  expect(getInput(rendered.container, 'rename-folder-name').value).toBe('Følder B');
  await act(async () => {
    getInput(rendered.container, 'rename-folder-name').dispatchEvent(
      new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
  });
  expect(closeCount).toBe(1);
  rendered.unmount();
});

test('rename file preserves a single-file extension and applies multi-file sequence exactly once', async () => {
  const rendered = createRenderedRoot();
  const savedTemplates: string[] = [];
  const baseProps = { isOpen: true, onClose: () => undefined, onSave: (value: string) => savedTemplates.push(value) };
  await render(
    rendered.root,
    createElement(RenameFileModal, {
      ...baseProps,
      filesToRename: ['/Photo Library/旅行/Émulsion scan 01.CR3'],
    }),
  );
  expect(getInput(rendered.container, 'rename-file-template').value).toBe('Émulsion scan 01');
  await render(
    rendered.root,
    createElement(RenameFileModal, {
      ...baseProps,
      filesToRename: ['/Photo Library/one.CR3', '/Photo Library/two.CR3'],
    }),
  );
  expect(getInput(rendered.container, 'rename-file-template').value).toBe('{original_filename}');
  await setInputValue(rendered.container, 'rename-file-template', 'Roll selects');
  expect(getButton(rendered.container, 'rename-file-submit').disabled).toBe(false);
  await act(async () => {
    const input = getInput(rendered.container, 'rename-file-template');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    input.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
  });
  expect(savedTemplates).toEqual(['Roll selects_{sequence}']);
  rendered.unmount();
});

test('tagging keeps edits across equivalent tag-array allocation and resets only for a new keyed invocation', async () => {
  const rendered = createRenderedRoot();
  const changedTags: string[][] = [];
  let hideCount = 0;
  const baseProps = {
    appSettings: null,
    hideContextMenu: () => hideCount++,
    invokeCommand,
    onTagsChanged: (_paths: string[], tags: Array<{ tag: string }>) => changedTags.push(tags.map(({ tag }) => tag)),
    paths: ['/Photo Library/旅行/scan one.CR3'],
  };
  await render(
    rendered.root,
    createElement(TaggingDraft, {
      ...baseProps,
      initialTags: [{ isUser: true, tag: 'alpha' }],
      key: 'menu-1',
    }),
  );
  const tagInput = rendered.container.querySelector('input');
  if (!(tagInput instanceof HTMLInputElement)) throw new Error('Expected tagging input.');
  await setElementValue(tagInput, 'beta');
  await act(async () => {
    tagInput.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    tagInput.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await flush();
  });
  expect(invokeCalls).toHaveLength(1);
  expect(changedTags).toEqual([['alpha', 'beta']]);
  await act(async () => {
    tagInput.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  });
  expect(hideCount).toBe(1);

  await render(
    rendered.root,
    createElement(TaggingDraft, {
      ...baseProps,
      initialTags: [{ isUser: true, tag: 'alpha' }],
      key: 'menu-1',
    }),
  );
  expect(rendered.container.textContent).toContain('beta');
  await render(
    rendered.root,
    createElement(TaggingDraft, {
      ...baseProps,
      initialTags: [{ isUser: true, tag: 'gamma' }],
      key: 'menu-2',
    }),
  );
  expect(rendered.container.textContent).toContain('gamma');
  expect(rendered.container.textContent).not.toContain('beta');
  rendered.unmount();
});

function createRenderedRoot(): { container: HTMLDivElement; root: Root; unmount: () => void } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function render(root: Root, child: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, child));
    await flush();
  });
}

function getInput(container: HTMLDivElement, testId: string): HTMLInputElement {
  const input = container.querySelector(`[data-testid="${testId}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Expected input ${testId}.`);
  return input;
}

function getButton(container: HTMLDivElement, testId: string): HTMLButtonElement {
  const button = container.querySelector(`[data-testid="${testId}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Expected button ${testId}.`);
  return button;
}

async function setInputValue(container: HTMLDivElement, testId: string, value: string) {
  await setElementValue(getInput(container, testId), value);
}

async function setElementValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (valueSetter === undefined) throw new Error('Expected input value setter.');
    valueSetter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    const reactPropsKey = Object.keys(input).find((key) => key.startsWith('__reactProps$'));
    if (reactPropsKey === undefined) throw new Error('Expected React input props.');
    const reactProps = Reflect.get(input, reactPropsKey) as {
      onChange?: (event: { currentTarget: HTMLInputElement; target: HTMLInputElement }) => void;
    };
    reactProps.onChange?.({ currentTarget: input, target: input });
    await flush();
  });
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function installDom() {
  const testWindow = new Window({ pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, {
    document: testWindow.document,
    Element: testWindow.Element,
    HTMLElement: testWindow.HTMLElement,
    HTMLButtonElement: testWindow.HTMLButtonElement,
    HTMLInputElement: testWindow.HTMLInputElement,
    KeyboardEvent: testWindow.KeyboardEvent,
    MouseEvent: testWindow.MouseEvent,
    navigator: testWindow.navigator,
    requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
    window: testWindow,
  });
}

async function createTestI18n() {
  const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: locale } },
  });
  return instance;
}
