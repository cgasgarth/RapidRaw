import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { act, type RenderResult, render as testingRender } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { createElement, type ReactElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

const invokeCalls: Array<{ args: unknown; command: string }> = [];
const invokeCommand = (command: string, args?: unknown) => {
  invokeCalls.push({ args, command });
  return Promise.resolve(null);
};

const i18n = await createTestI18n();
const { default: CreateFolderModal } = await import('../../../src/components/modals/library/CreateFolderModal.tsx');
const { default: RenameFolderModal } = await import('../../../src/components/modals/library/RenameFolderModal.tsx');
const { default: RenameFileModal } = await import('../../../src/components/modals/library/RenameFileModal.tsx');
const { TaggingDraft } = await import('../../../src/context/TaggingSubMenu.tsx');

test('create folder cancel/reopen discards the abandoned draft and guards duplicate submission', async () => {
  const savedNames: string[] = [];
  const props = {
    isOpen: true,
    onClose: () => undefined,
    onSave: (name: string) => savedNames.push(name),
    operationScope: '/Volumes/Photo Library/Ålesund 旅行',
  };
  const rendered = render(createElement(CreateFolderModal, props));
  await setInputValue(rendered.container, 'create-folder-name', 'Abandoned draft');
  rerender(rendered, createElement(CreateFolderModal, { ...props, isOpen: false }));
  rerender(rendered, createElement(CreateFolderModal, props));
  const reopenedInput = getInput(rendered.container, 'create-folder-name');
  expect(reopenedInput.value).toBe('');

  await setInputValue(rendered.container, 'create-folder-name', '  New selects  ');
  expect(getButton(rendered.container, 'create-folder-submit').disabled).toBe(false);
  const user = userEvent.setup({ delay: 1 });
  await user.click(getButton(rendered.container, 'create-folder-submit'));
  await user.click(getButton(rendered.container, 'create-folder-submit'));
  expect(savedNames).toEqual(['New selects']);
});

test('rename folder switches A to B synchronously and same-folder reopen gets a new draft', async () => {
  let closeCount = 0;
  const baseProps = { isOpen: true, onClose: () => closeCount++, onSave: () => undefined };
  const rendered = render(
    createElement(RenameFolderModal, {
      ...baseProps,
      currentName: 'Folder A',
      operationScope: '/library/Folder A',
    }),
  );
  await setInputValue(rendered.container, 'rename-folder-name', 'Abandoned A');
  rerender(
    rendered,
    createElement(RenameFolderModal, {
      ...baseProps,
      currentName: 'Følder B',
      operationScope: '/library/Følder B',
    }),
  );
  expect(getInput(rendered.container, 'rename-folder-name').value).toBe('Følder B');
  await setInputValue(rendered.container, 'rename-folder-name', 'Abandoned B');
  rerender(
    rendered,
    createElement(RenameFolderModal, {
      ...baseProps,
      currentName: 'Følder B',
      isOpen: false,
      operationScope: '/library/Følder B',
    }),
  );
  rerender(
    rendered,
    createElement(RenameFolderModal, {
      ...baseProps,
      currentName: 'Følder B',
      operationScope: '/library/Følder B',
    }),
  );
  expect(getInput(rendered.container, 'rename-folder-name').value).toBe('Følder B');
  await userEvent.setup().type(getInput(rendered.container, 'rename-folder-name'), '{Escape}');
  expect(closeCount).toBe(1);
});

test('rename file preserves a single-file extension and applies multi-file sequence exactly once', async () => {
  const savedTemplates: string[] = [];
  const baseProps = { isOpen: true, onClose: () => undefined, onSave: (value: string) => savedTemplates.push(value) };
  const rendered = render(
    createElement(RenameFileModal, {
      ...baseProps,
      filesToRename: ['/Photo Library/旅行/Émulsion scan 01.CR3'],
    }),
  );
  expect(getInput(rendered.container, 'rename-file-template').value).toBe('Émulsion scan 01');
  rerender(
    rendered,
    createElement(RenameFileModal, {
      ...baseProps,
      filesToRename: ['/Photo Library/one.CR3', '/Photo Library/two.CR3'],
    }),
  );
  expect(getInput(rendered.container, 'rename-file-template').value).toBe('{original_filename}');
  await setInputValue(rendered.container, 'rename-file-template', 'Roll selects');
  expect(getButton(rendered.container, 'rename-file-submit').disabled).toBe(false);
  const input = getInput(rendered.container, 'rename-file-template');
  await userEvent.setup().type(input, '{Enter}{Enter}');
  expect(savedTemplates).toEqual(['Roll selects_{sequence}']);
});

test('tagging keeps edits across equivalent tag-array allocation and resets only for a new keyed invocation', async () => {
  const changedTags: string[][] = [];
  let hideCount = 0;
  const baseProps = {
    appSettings: null,
    hideContextMenu: () => hideCount++,
    invokeCommand,
    onTagsChanged: (_paths: string[], tags: Array<{ tag: string }>) => changedTags.push(tags.map(({ tag }) => tag)),
    paths: ['/Photo Library/旅行/scan one.CR3'],
  };
  const rendered = render(
    createElement(TaggingDraft, {
      ...baseProps,
      initialTags: [{ isUser: true, tag: 'alpha' }],
      key: 'menu-1',
    }),
  );
  const tagInput = rendered.container.querySelector('input');
  if (!(tagInput instanceof HTMLInputElement)) throw new Error('Expected tagging input.');
  await setElementValue(tagInput, 'beta');
  const user = userEvent.setup();
  await user.type(tagInput, '{Enter}{Enter}');
  expect(invokeCalls).toHaveLength(1);
  expect(changedTags).toEqual([['alpha', 'beta']]);
  await user.type(tagInput, '{Escape}');
  expect(hideCount).toBe(1);

  rerender(
    rendered,
    createElement(TaggingDraft, {
      ...baseProps,
      initialTags: [{ isUser: true, tag: 'alpha' }],
      key: 'menu-1',
    }),
  );
  expect(rendered.container.textContent).toContain('beta');
  rerender(
    rendered,
    createElement(TaggingDraft, {
      ...baseProps,
      initialTags: [{ isUser: true, tag: 'gamma' }],
      key: 'menu-2',
    }),
  );
  expect(rendered.container.textContent).toContain('gamma');
  expect(rendered.container.textContent).not.toContain('beta');
});

function render(child: ReactElement): RenderResult {
  return testingRender(createElement(I18nextProvider, { i18n }, child));
}

function rerender(rendered: RenderResult, child: ReactElement) {
  rendered.rerender(createElement(I18nextProvider, { i18n }, child));
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
    await Bun.sleep(50);
  });
  input.focus();
  input.select();
  const user = userEvent.setup();
  await user.type(input, value, { skipClick: true });
  expect(input).toHaveValue(value);
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
