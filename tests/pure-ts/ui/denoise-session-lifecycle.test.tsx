import { afterEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

type ProgressListener = (event: { payload: unknown }) => void;
const progressListeners: ProgressListener[] = [];
const unlisten = mock(() => {});
const listen = mock(async (_event: string, callback: ProgressListener) => {
  progressListeners.push(callback);
  return unlisten;
});
mock.module('@tauri-apps/api/event', () => ({ listen }));

const { DenoiseSession, createDenoiseSessionIdentity, initialDenoiseDraft } = await import(
  '../../../src/components/modals/editing/DenoiseModal'
);
const { isCurrentDenoiseEvent } = await import('../../../src/schemas/denoiseWorkflowSchemas');

let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  progressListeners.length = 0;
  listen.mockClear();
  unlisten.mockClear();
  globalThis.document?.body.replaceChildren();
});

test('pure defaults and identity distinguish source mode, ordering, and same-target reopen', () => {
  expect(initialDenoiseDraft(true)).toEqual({ intensity: 50, method: 'ai' });
  expect(initialDenoiseDraft(false)).toEqual({ intensity: 15, method: 'bm3d' });
  expect(createDenoiseSessionIdentity(['/a', '/b'], true, 1)).not.toBe(
    createDenoiseSessionIdentity(['/b', '/a'], true, 1),
  );
  expect(createDenoiseSessionIdentity(['/a'], true, 1)).not.toBe(createDenoiseSessionIdentity(['/a'], true, 2));
  expect(createDenoiseSessionIdentity(['/a'], true, 1)).not.toBe(createDenoiseSessionIdentity(['/a'], false, 1));
});

test('RAW and raster sessions synchronously render their own defaults and preserve user choice', async () => {
  const runtime = installRuntime();
  cleanup = runtime.unmount;
  await runtime.render('raw:1', props({ isRaw: true, targetPaths: ['/raw.ARW'] }));
  expect(runtime.summary().dataset.denoiseMethod).toBe('ai');
  expect(runtime.summary().dataset.denoiseIntensity).toBe('50');

  await runtime.click(runtime.button('modals.denoise.methodAi'));
  await runtime.click(runtime.button('modals.denoise.methodBm3d'));
  expect(runtime.summary().dataset.denoiseMethod).toBe('bm3d');
  expect(runtime.summary().dataset.denoiseIntensity).toBe('15');
  await runtime.render('raw:1', props({ isRaw: true, progressMessage: 'unrelated render', targetPaths: ['/raw.ARW'] }));
  expect(runtime.summary().dataset.denoiseMethod).toBe('bm3d');

  await runtime.render('raster:2', props({ isRaw: false, targetPaths: ['/image.jpg'] }));
  expect(runtime.summary().dataset.denoiseMethod).toBe('bm3d');
  expect(runtime.summary().dataset.denoiseIntensity).toBe('15');
  await runtime.render('raw:3', props({ isRaw: true, targetPaths: ['/raw.ARW'] }));
  expect(runtime.summary().dataset.denoiseMethod).toBe('ai');
  expect(runtime.summary().dataset.denoiseIntensity).toBe('50');
});

test('superseded batch completion and progress cannot populate the successor session', async () => {
  const deferred = createDeferred<string[]>();
  const batch = mock(() => deferred.promise);
  const runtime = installRuntime();
  cleanup = runtime.unmount;
  await runtime.render('batch-a', props({ onBatchDenoise: batch, targetPaths: ['/a.ARW', '/b.ARW'] }));
  expect(progressListeners).toHaveLength(1);
  await runtime.click(runtime.button('modals.denoise.btnBatchDenoise'));
  expect(batch).toHaveBeenCalledTimes(1);
  await act(async () => progressListeners[0]?.({ payload: { current: 1, path: '/a.ARW', total: 2 } }));

  await runtime.render('batch-b', props({ targetPaths: ['/c.ARW', '/d.ARW'] }));
  expect(unlisten).toHaveBeenCalledTimes(1);
  await act(async () => progressListeners[0]?.({ payload: { current: 2, path: '/a.ARW', total: 2 } }));
  await act(async () => deferred.resolve(['/outputs/a.png', '/outputs/b.png']));
  expect(runtime.container.querySelector('[data-testid="denoise-batch-completion-summary"]')).toBeNull();
  expect(runtime.container.textContent).not.toContain('a.ARW');
});

test('closing a pending single-image run cancels once and a reopened session can start again', async () => {
  const cancel = mock(async () => {});
  const close = mock(() => {});
  const denoise = mock(() => {});
  const runtime = installRuntime();
  cleanup = runtime.unmount;
  await runtime.render('first', props({ onCancel: cancel, onClose: close, onDenoise: denoise }));
  await runtime.click(runtime.button('modals.denoise.btnStart'));
  expect(denoise).toHaveBeenCalledTimes(1);

  await runtime.render('first', props({ isProcessing: true, onCancel: cancel, onClose: close, onDenoise: denoise }));
  await runtime.click(runtime.button('modals.denoise.cancel'));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);

  await runtime.render('second', props({ onCancel: cancel, onClose: close, onDenoise: denoise }));
  await runtime.click(runtime.button('modals.denoise.btnStart'));
  expect(denoise).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledTimes(1);
});

test('unmounting a pending single-image session cancels its native generation', async () => {
  const cancel = mock(async () => {});
  const runtime = installRuntime();
  cleanup = runtime.unmount;
  await runtime.render('pending', props({ isProcessing: true, onCancel: cancel }));
  await runtime.unmount();
  cleanup = null;
  expect(cancel).toHaveBeenCalledTimes(1);
});

test('replacing a pending session cancels the captured old handle, never the successor handle', async () => {
  const oldOperation = { imageGeneration: 9, operationGeneration: 2 };
  const successor = { imageGeneration: 10, operationGeneration: 3 };
  const cancel = mock(async () => {});
  const runtime = installRuntime();
  cleanup = runtime.unmount;
  await runtime.render('old', props({ activeOperation: oldOperation, isProcessing: true, onCancel: cancel }));
  await runtime.render('successor', props({ activeOperation: successor, isProcessing: true, onCancel: cancel }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledWith(oldOperation);
});

test('old progress, complete, and error handles are ignored by successor and closed sessions', () => {
  const oldOperation = { imageGeneration: 3, operationGeneration: 7 };
  const successor = { imageGeneration: 3, operationGeneration: 8 };
  const activeState = { activeOperation: successor, isOpen: true, isProcessing: true };
  for (const _eventType of ['progress', 'complete', 'error']) {
    expect(isCurrentDenoiseEvent(activeState, oldOperation)).toBe(false);
    expect(isCurrentDenoiseEvent(activeState, successor)).toBe(true);
    expect(isCurrentDenoiseEvent({ ...activeState, isOpen: false }, successor)).toBe(false);
  }
});

test('two-phase start installs the handle before execution can emit a terminal event', async () => {
  const operation = { imageGeneration: 5, operationGeneration: 11 };
  const start = createDeferred<typeof operation>();
  let state = { activeOperation: null as typeof operation | null, isOpen: true, isProcessing: true };
  let executeCalls = 0;
  const launch = (async () => {
    const handle = await start.promise;
    state = { ...state, activeOperation: handle };
    executeCalls += 1;
  })();

  expect(isCurrentDenoiseEvent(state, operation)).toBe(false);
  expect(executeCalls).toBe(0);
  start.resolve(operation);
  await launch;
  expect(executeCalls).toBe(1);
  expect(isCurrentDenoiseEvent(state, operation)).toBe(true);
  if (isCurrentDenoiseEvent(state, operation)) {
    state = { ...state, activeOperation: null, isProcessing: false };
  }
  expect(state.isProcessing).toBe(false);
});

function props(overrides: Partial<React.ComponentProps<typeof DenoiseSession>> = {}) {
  return {
    activeOperation: null,
    aiModelDownloadStatus: null,
    error: null,
    isActive: true,
    isProcessing: false,
    isRaw: true,
    loadingImageUrl: null,
    onBatchDenoise: async () => [],
    onCancel: async () => {},
    onClose: () => {},
    onDenoise: () => {},
    onOpenFile: () => {},
    onSave: async () => '/output.png',
    originalBase64: null,
    previewBase64: null,
    progressMessage: null,
    sessionId: 'session',
    show: true,
    targetPaths: ['/image.ARW'],
    ...overrides,
  } satisfies React.ComponentProps<typeof DenoiseSession>;
}

function installRuntime() {
  const window = new Window({ url: 'http://localhost' });
  Object.assign(globalThis, {
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    navigator: window.navigator,
    Node: window.Node,
    window,
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let mounted = true;
  return {
    button: (text: string) => {
      const button = [...container.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes(text),
      );
      if (!button) throw new Error(`Missing button ${text}`);
      return button;
    },
    click: async (element: Element) =>
      act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))),
    container,
    render: async (key: string, sessionProps: React.ComponentProps<typeof DenoiseSession>) =>
      act(async () => root.render(createElement(DenoiseSession, { ...sessionProps, key, sessionId: key }))),
    summary: () => {
      const summary = container.querySelector<HTMLElement>('[data-testid="denoise-setup-summary"]');
      if (!summary) throw new Error('Missing denoise summary');
      return summary;
    },
    unmount: async () => {
      if (!mounted) return;
      mounted = false;
      await act(async () => root.unmount());
    },
  };
}

function createDeferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
