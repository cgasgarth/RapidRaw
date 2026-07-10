import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import AgentChatShell, { buildAgentChatTimeline } from '../../../src/components/panel/right/ai/AgentChatShell.tsx';
import { AgentPanel } from '../../../src/components/panel/right/ai/AgentPanel.tsx';
import type { SelectedImage } from '../../../src/components/ui/AppProperties.tsx';
import en from '../../../src/i18n/locales/en.json';
import type { AgentChatTranscript } from '../../../src/schemas/agent/agentChatTranscriptSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { buildAgentMediumPreviewEncodedBytesForTest } from '../../../src/utils/agent/context/agentMediumPreviewArtifactRuntime.ts';
import { getRawEngineImagePreview } from '../../../src/utils/agent/context/agentReadOnlyAppServerTools.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const selectedImage: SelectedImage = {
  exif: { ISO: '200', LensModel: 'FE 35mm F1.4 GM' },
  height: 4000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: 'blob:agent-chat-shell-original',
  path: '/validation/agent-chat-shell/DSC_4850.ARW',
  rawDevelopmentReport: null,
  thumbnailUrl: 'data:image/jpeg;base64,AAAA',
  width: 6000,
};

const transcript: AgentChatTranscript = {
  id: 'agent-chat-shell-test',
  messages: [
    {
      body: 'I will keep the current image as the edit target.',
      id: 'existing-assistant-message',
      role: 'assistant',
      timestamp: '09:41',
    },
  ],
  runtimeStatus: 'runtime_apply_ready',
  sessionTitle: 'Current image: DSC_4850.ARW',
  toolCalls: [
    {
      approvalState: 'not_required',
      id: 'current-image-context',
      mode: 'read',
      provenance: {
        requestHash: 'sha256:agent-chat-shell-test',
        runtime: 'codex_app_server',
        schema: 'agentChatShellTest.v1',
      },
      status: 'succeeded',
      summary: 'Selected image context is ready.',
      timestamp: '09:41',
      title: 'Image context',
      toolName: 'rawengine.live_context',
    },
  ],
};

interface TauriTestWindow extends Window {
  __TAURI_INTERNALS__: {
    convertFileSrc: (path: string) => string;
    invoke: () => Promise<ArrayBuffer>;
  };
}

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;
let previewInvokeDelayMs = 0;

beforeEach(() => {
  previewInvokeDelayMs = 0;
  seedEditor();
});

afterEach(() => {
  if (renderedRoot !== null) {
    act(() => {
      renderedRoot?.root.unmount();
    });
    renderedRoot.container.remove();
    renderedRoot = null;
  }
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    selectedImage: null,
  });
});

describe('agent chat shell', () => {
  test('keeps transcript messages before live events and shows the selected RAW identity', async () => {
    const timeline = buildAgentChatTimeline(transcript, [
      {
        body: 'Recover highlights without changing the sky color.',
        id: 'live-user-message',
        role: 'user',
        timestamp: 'now',
      },
    ]);
    expect(timeline.map((message) => message.id)).toEqual(['existing-assistant-message', 'live-user-message']);

    const { container } = await render(createElement(AgentPanel));
    expect(
      required<HTMLElement>(container, '[data-testid="agent-right-rail-panel"]').dataset.reviewWorkspaceState,
    ).toBe('ready');
    expect(required<HTMLElement>(container, 'h2').textContent).toBe('DSC_4850.ARW');
    expect(container.textContent).toContain('6000 x 4000');
    expect(container.querySelector('img[alt=""]')).not.toBeNull();
  });

  test('renders a compact typed preview, applies it, restores focus, and keeps lifecycle status in one surface', async () => {
    const { container } = await render(createElement(AgentChatShell, { transcript }));
    const composer = required<HTMLElement>(container, '[data-testid="agent-live-prompt-composer"]');
    const input = required<HTMLTextAreaElement>(container, '[data-testid="agent-live-prompt-input"]');

    await act(async () => {
      quickStart(container, 'Recover highlights').click();
      await flush();
    });
    expect(required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-run"]').disabled).toBe(false);
    await act(async () => {
      required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-run"]').click();
      await flush();
    });
    await waitFor(() => composer.dataset.livePromptStatus !== 'previewing');
    if (composer.dataset.livePromptStatus !== 'dry_run_ready') {
      throw new Error(
        `Expected a ready preview, got ${composer.dataset.livePromptStatus}: ${container.querySelector('[data-testid="agent-live-prompt-error"]')?.textContent ?? 'no error'}`,
      );
    }

    const result = required<HTMLElement>(container, '[data-testid="agent-photographer-result"]');
    expect(result.dataset.proposalState).toBe('dry_run_ready');
    expect(result.querySelectorAll('[data-testid="agent-photographer-before-after"] img')).toHaveLength(2);
    expect(required<HTMLElement>(result, '[data-testid="agent-selected-image-proposal-state"]').textContent).toContain(
      'ready',
    );
    expect(result.querySelector('[data-testid="agent-live-prompt-apply"]')).not.toBeNull();
    expect(document.activeElement).toBe(input);

    const messageIds = Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="agent-chat-message-"]')).map(
      (message) => message.dataset.testid,
    );
    expect(messageIds).toEqual([
      'agent-chat-message-existing-assistant-message',
      expect.stringContaining('live-agent-session-'),
      expect.stringContaining('live-agent-session-'),
    ]);

    await act(async () => {
      required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-apply"]').click();
      await flush();
    });
    await waitFor(() => composer.dataset.livePromptStatus === 'applied');
    expect(required<HTMLElement>(container, '[data-testid="agent-photographer-result"]').dataset.proposalState).toBe(
      'applied',
    );
    expect(container.querySelector('[data-testid="agent-live-prompt-rollback"]')).not.toBeNull();
    expect(document.activeElement).toBe(input);

    await act(async () => {
      required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-rollback"]').click();
      await flush();
    });
    await waitFor(() => composer.dataset.livePromptStatus === 'rolled_back');
    expect(required<HTMLElement>(container, '[data-testid="agent-photographer-result"]').dataset.proposalState).toBe(
      'rolled_back',
    );
    expect(document.activeElement).toBe(input);
  });

  test('keeps a runtime failure in a concise lifecycle state instead of duplicating chat status messages', async () => {
    useEditorStore.getState().setEditor({ selectedImage: null });
    const { container } = await render(createElement(AgentChatShell, { transcript }));
    const composer = required<HTMLElement>(container, '[data-testid="agent-live-prompt-composer"]');

    await act(async () => {
      quickStart(container, 'Recover highlights').click();
      await flush();
    });
    expect(required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-run"]').disabled).toBe(false);
    await act(async () => {
      required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-run"]').click();
      await flush();
    });
    await waitFor(() => composer.dataset.livePromptStatus === 'failed');

    expect(required<HTMLElement>(container, '[data-testid="agent-live-prompt-error"]').textContent).toContain(
      'Select an image before previewing',
    );
    expect(container.querySelectorAll('[data-testid^="agent-chat-message-"]')).toHaveLength(1);
    expect(required<HTMLElement>(container, '[data-testid="agent-photographer-result"]').className).toContain(
      'overflow-hidden',
    );
  });

  test('cancels an in-flight preview with Escape and restores the composer focus', async () => {
    previewInvokeDelayMs = 30;
    const { container } = await render(createElement(AgentChatShell, { transcript }));
    const composer = required<HTMLElement>(container, '[data-testid="agent-live-prompt-composer"]');
    const input = required<HTMLTextAreaElement>(container, '[data-testid="agent-live-prompt-input"]');

    await act(async () => {
      quickStart(container, 'Recover highlights').click();
      await flush();
      required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-run"]').click();
      await flush();
    });
    await waitFor(() => composer.dataset.livePromptStatus === 'previewing');

    await act(async () => {
      input.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      await flush();
    });
    await waitFor(() => composer.dataset.livePromptStatus === 'cancelled');

    expect(required<HTMLElement>(container, '[data-testid="agent-photographer-result"]').dataset.proposalState).toBe(
      'cancelled',
    );
    expect(document.activeElement).toBe(input);
  });
});

async function render(element: ReturnType<typeof createElement>) {
  installDom();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const i18n = await createTestI18n();

  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, element));
    await flush();
  });

  renderedRoot = { container, root };
  return { container, root };
}

function seedEditor() {
  useEditorStore.getState().setEditor({
    adjustments: INITIAL_ADJUSTMENTS,
    finalPreviewUrl: 'blob:agent-chat-shell-before',
    hasRenderedFirstFrame: true,
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage,
    uncroppedAdjustedPreviewUrl: null,
  });
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for agent chat state.');
    await act(async () => {
      await flush();
    });
  }
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function installDom() {
  const window = new Window({ url: 'http://localhost/agent-chat-shell' });
  const currentImage = useEditorStore.getState().selectedImage;
  const tinyJpeg =
    currentImage === null
      ? new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer
      : (() => {
          const currentPreview = getRawEngineImagePreview({ requestId: 'agent-chat-shell-ui-preview' });
          return buildAgentMediumPreviewEncodedBytesForTest({
            graphRevision: currentPreview.receipt.graphRevision,
            imagePath: currentImage.path,
            preview: currentPreview.preview,
          }).buffer;
        })();
  const tauriWindow = window as TauriTestWindow;
  tauriWindow.__TAURI_INTERNALS__ = {
    convertFileSrc: (path) => path,
    invoke: async () => {
      if (previewInvokeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, previewInvokeDelayMs));
      return tinyJpeg.slice(0);
    },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}

function quickStart(container: Element, label: string): HTMLButtonElement {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-testid="agent-live-prompt-quick-starts"] button'),
  ).find((candidate) => candidate.textContent === label);
  if (button === undefined) throw new Error(`Expected quick start ${label}.`);
  return button;
}

async function createTestI18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  return instance;
}
