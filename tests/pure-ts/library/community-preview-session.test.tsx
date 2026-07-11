import { afterEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

interface Invocation {
  args: Record<string, unknown>;
  command: string;
  deferred: Deferred<unknown>;
}
interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

const invocations: Invocation[] = [];
const invoke = mock((command: string, args: Record<string, unknown> = {}) => {
  const deferred = createDeferred<unknown>();
  invocations.push({ args, command, deferred });
  return deferred.promise;
});
mock.module('@tauri-apps/api/core', () => ({ invoke }));

const { CommunityPreviewSession, buildSaveCommunityPresetPayload } = await import(
  '../../../src/components/panel/CommunityPage'
);
type CommunityPreset = import('../../../src/components/panel/CommunityPage').CommunityPreset;

const preset = (name: string): CommunityPreset => ({ adjustments: { exposure: 0.5 }, creator: 'Tester', name });
let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  await cleanup?.();
  cleanup = null;
  invocations.length = 0;
  invoke.mockClear();
  document?.body.replaceChildren();
});

test('rejects stale folder and preset generations, revokes their URLs, and owns the final map until unmount', async () => {
  const { container, render, unmount, revoked } = installRuntime();
  cleanup = unmount;

  await render('folder-a', ['/a.RAW'], [preset('A')]);
  const requestA = generation(0);
  expect(requestA.args.imagePaths).toEqual(['/a.RAW']);
  expect((requestA.args.presets as CommunityPreset[])[0]?.adjustments).toMatchObject({ exposure: 0.5, contrast: 0 });

  await render('folder-b', ['/b.RAW'], [preset('A')]);
  const requestB = generation(1);
  await act(async () => requestA.deferred.resolve({ A: [1] }));
  expect(revoked).toEqual(['blob:1']);
  expect(container.textContent).not.toContain('blob:1');

  await render('folder-b', ['/b.RAW'], [preset('B')]);
  const requestPresetB = generation(2);
  await act(async () => requestB.deferred.resolve({ A: [2] }));
  expect(revoked).toEqual(['blob:1', 'blob:2']);

  await act(async () => requestPresetB.deferred.resolve({ B: [3] }));
  expect(container.textContent).toContain('blob:3');
  await unmount();
  cleanup = null;
  expect(revoked).toEqual(['blob:1', 'blob:2', 'blob:3']);
});

test('equivalent source and preset allocations do not regenerate', async () => {
  const { render, unmount } = installRuntime();
  cleanup = unmount;
  await render('same', ['/one.RAW'], [preset('A')]);
  expect(invocations).toHaveLength(1);
  await render('same', ['/one.RAW'], [preset('A')]);
  expect(invocations).toHaveLength(1);
});

test('replaces a current preview map by revoking its URLs exactly once', async () => {
  const { render, revoked, unmount } = installRuntime();
  cleanup = unmount;
  await render('folder', ['/one.RAW'], [preset('A')]);
  await act(async () => generation(0).deferred.resolve({ A: [1] }));
  expect(revoked).toEqual([]);

  await render('folder', ['/one.RAW'], [preset('B')]);
  await act(async () => generation(1).deferred.resolve({ B: [2] }));
  expect(revoked).toEqual(['blob:1']);
  await unmount();
  cleanup = null;
  expect(revoked).toEqual(['blob:1', 'blob:2']);
});

test('accepts a fallback path only in the keyed session that requested it', async () => {
  const fallbackRequests: Deferred<Response>[] = [];
  const { render, unmount } = installRuntime(() => {
    const request = createDeferred<Response>();
    fallbackRequests.push(request);
    return request.promise;
  });
  cleanup = unmount;

  await render('empty-a', [], [preset('A')]);
  await render('empty-b', [], [preset('A')]);
  expect(fallbackRequests).toHaveLength(2);

  await act(async () => fallbackRequests[0]?.resolve(new Response(new Uint8Array([1]))));
  const oldSave = command('save_temp_file', 0);
  await act(async () => oldSave.deferred.resolve('/tmp/old.jpg'));
  expect(invocations.filter(({ command }) => command === 'generate_all_community_previews')).toHaveLength(0);

  await act(async () => fallbackRequests[1]?.resolve(new Response(new Uint8Array([2]))));
  const currentSave = command('save_temp_file', 1);
  await act(async () => currentSave.deferred.resolve('/tmp/current.jpg'));
  expect(generation(0).args.imagePaths).toEqual(['/tmp/current.jpg']);
});

test('preserves the Save Community Preset payload contract', () => {
  expect(
    buildSaveCommunityPresetPayload({
      adjustments: { exposure: 1 },
      creator: 'Author',
      includeCropTransform: true,
      includeMasks: false,
      name: 'Preset',
    }),
  ).toEqual({
    adjustments: { exposure: 1 },
    includeCropTransform: true,
    includeMasks: false,
    name: 'Preset',
    presetType: 'style',
  });
});

function installRuntime(fetchImplementation?: () => Promise<Response>) {
  const window = new Window({ url: 'http://localhost' });
  const revoked: string[] = [];
  let objectUrl = 0;
  Object.assign(globalThis, {
    Blob: window.Blob,
    document: window.document,
    fetch: fetchImplementation ?? globalThis.fetch,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    navigator: window.navigator,
    Node: window.Node,
    window,
  });
  Object.assign(URL, {
    createObjectURL: () => `blob:${++objectUrl}`,
    revokeObjectURL: (url: string) => revoked.push(url),
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let mounted = true;
  return {
    container,
    revoked,
    render: async (sessionId: string, localPaths: string[], presets: CommunityPreset[]) => {
      await act(async () => {
        root.render(
          createElement(
            CommunityPreviewSession,
            { key: sessionId, localPaths, presets, sessionId },
            (previews: Record<string, string | null>) => JSON.stringify(previews),
          ),
        );
      });
    },
    unmount: async () => {
      if (!mounted) return;
      mounted = false;
      await act(async () => root.unmount());
    },
  };
}

function generation(index: number): Invocation {
  return command('generate_all_community_previews', index);
}

function command(name: string, index: number): Invocation {
  const invocation = invocations.filter(({ command }) => command === name)[index];
  if (!invocation) throw new Error(`Missing generation ${index}`);
  return invocation;
}

function createDeferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
