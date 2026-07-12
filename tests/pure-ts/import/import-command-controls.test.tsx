import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '../../../src/i18n/locales/en.json';

const invocations: Array<{ args: unknown; command: string }> = [];
let resumeValidation = {
  invalid: [] as Array<{ error: string; itemId: number; source: string; stage: 'inspecting' }>,
  jobId: 'import-100',
  resumable: [2, 3],
  verifiedCompleted: [0, 1],
};
const invoke = mock(async (command: string, args: unknown) => {
  invocations.push({ args, command });
  if (command === 'cancel_import') return true;
  if (command === 'validate_import_job_resume') return resumeValidation;
  if (command === 'resume_import_job') return 'import-100';
  throw new Error(`Unexpected invoke: ${command}`);
});
mock.module('@tauri-apps/api/core', () => ({ invoke }));
mock.module('react-toastify', () => ({
  toast: { error: mock(() => undefined), success: mock(() => undefined) },
}));

const { ImportCancellationButton, ImportResumeButton } = await import(
  '../../../src/components/panel/library/ImportJobControls'
);
const { Status } = await import('../../../src/components/ui/ExportImportProperties');
const { useProcessStore } = await import('../../../src/store/useProcessStore');

let runtime: { container: HTMLDivElement; root: Root } | null = null;

beforeEach(() => {
  invocations.length = 0;
  invoke.mockClear();
  resumeValidation = {
    invalid: [],
    jobId: 'import-100',
    resumable: [2, 3],
    verifiedCompleted: [0, 1],
  };
  useProcessStore.setState({
    importState: {
      errorMessage: '',
      jobId: 'import-100',
      path: '',
      progress: { current: 2, total: 4 },
      status: Status.Cancelled,
    },
  });
});

afterEach(() => {
  if (runtime) act(() => runtime?.root.unmount());
  runtime?.container.remove();
  runtime = null;
});

describe('import command controls', () => {
  test('Cancel invokes cooperative cancellation from the visible import action', async () => {
    const { container } = await renderControl(createElement(ImportCancellationButton));
    await click(container, 'Cancel');
    expect(invocations).toEqual([{ args: {}, command: 'cancel_import' }]);
  });

  test('Resume validates the journal, invokes resume, and returns UI state to importing', async () => {
    const { container } = await renderControl(
      createElement(ImportResumeButton, { importState: useProcessStore.getState().importState }),
    );
    await click(container, 'Resume Import');
    expect(invocations).toEqual([
      { args: { jobId: 'import-100' }, command: 'validate_import_job_resume' },
      { args: { jobId: 'import-100' }, command: 'resume_import_job' },
    ]);
    expect(useProcessStore.getState().importState.status).toBe(Status.Importing);
    expect(useProcessStore.getState().importState.resumeValidation?.resumable).toEqual([2, 3]);
  });

  test('Resume rejects changed sources before invoking the resume command', async () => {
    resumeValidation = {
      invalid: [
        {
          error: 'source revision changed',
          itemId: 2,
          source: '/camera/capture-002.ARW',
          stage: 'inspecting',
        },
      ],
      jobId: 'import-100',
      resumable: [],
      verifiedCompleted: [0, 1],
    };
    const { container } = await renderControl(
      createElement(ImportResumeButton, { importState: useProcessStore.getState().importState }),
    );
    await click(container, 'Resume Import');
    expect(invocations.map(({ command }) => command)).toEqual(['validate_import_job_resume']);
    expect(useProcessStore.getState().importState.status).toBe(Status.Cancelled);
    expect(useProcessStore.getState().importState.resumeValidation?.invalid).toHaveLength(1);
  });
});

async function renderControl(control: ReturnType<typeof createElement>) {
  const window = new Window({ url: 'http://localhost' });
  Object.assign(globalThis, {
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    navigator: window.navigator,
    Node: window.Node,
    window,
  });
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({ fallbackLng: 'en', lng: 'en', resources: { en: { translation: en } } });
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  runtime = { container, root };
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n: i18next }, control));
    await Promise.resolve();
  });
  return { container };
}

async function click(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label || candidate.textContent?.includes(label),
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
