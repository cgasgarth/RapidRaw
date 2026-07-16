import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { render as testingRender, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { act, createElement, type ReactElement } from 'react';
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
import { setAgentSelectedImageModelTransportFactoryForTest } from '../../../src/utils/agent/session/agentCodexAppServerModelTransport.ts';
import type { AgentSelectedImageModelTransport } from '../../../src/utils/agent/session/agentSelectedImageModelToolLoop.ts';

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
const initialEditDocumentV2 = structuredClone(useEditorStore.getState().editDocumentV2);

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

let previewInvokeDelayMs = 0;

mock.module('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
  invoke: async () => {
    if (previewInvokeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, previewInvokeDelayMs));
    return buildPreviewBytes().slice(0);
  },
}));

const i18n = await createTestI18n();

beforeEach(() => {
  previewInvokeDelayMs = 0;
  seedEditor();
  setAgentSelectedImageModelTransportFactoryForTest(() => new UiTestModelTransport());
});

afterEach(() => {
  setAgentSelectedImageModelTransportFactoryForTest(undefined);
  act(() => {
    useEditorStore.getState().hydrateEditorRenderAuthority({
      editDocumentV2: initialEditDocumentV2,
      historyCheckpoints: [],
      historyIndex: 0,
      selectedImage: null,
      history: [initialEditDocumentV2],
    });
  });
});

class UiTestModelTransport implements AgentSelectedImageModelTransport {
  async runTurn(request: Parameters<AgentSelectedImageModelTransport['runTurn']>[0]) {
    return {
      modelId: 'ui-test-model',
      modelTurnId: `ui-test-turn-${request.turn}`,
      output:
        request.turn === 1
          ? {
              decision: 'call_tool',
              tool: {
                arguments: { patch: { highlights: -18 } },
                callId: 'ui-test-proposal-render',
                name: 'proposal_render',
              },
            }
          : { decision: 'finalize_proposal', proposalId: request.lineageHead?.proposalId },
      provider: 'deterministic-ui-test-only',
      providerVersion: '1',
    };
  }
}

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
    const modelConfiguration = required<HTMLElement>(container, '[data-testid="agent-model-configuration"]');
    expect(modelConfiguration.dataset.modelId).toBe('gpt-5.6-terra');
    expect(modelConfiguration.dataset.reasoningTier).toBe('light');
  });

  test('renders a compact typed preview, applies it, restores focus, and keeps lifecycle status in one surface', async () => {
    const { container } = await render(createElement(AgentChatShell, { transcript }));
    const composer = required<HTMLElement>(container, '[data-testid="agent-live-prompt-composer"]');
    const input = required<HTMLTextAreaElement>(container, '[data-testid="agent-live-prompt-input"]');
    const focusTracker = trackFocus(input);
    const user = userEvent.setup();

    await user.click(quickStart(container, 'Recover highlights'));
    expect(required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-run"]').disabled).toBe(false);
    await user.click(required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-run"]'));
    await waitFor(() => expect(composer.dataset.livePromptStatus).not.toBe('previewing'));
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
    await waitFor(() => expect(focusTracker.focus).toHaveBeenCalled());
    focusTracker.focus.mockClear();

    const messageIds = Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="agent-chat-message-"]')).map(
      (message) => message.dataset.testid,
    );
    expect(messageIds).toEqual([
      'agent-chat-message-existing-assistant-message',
      expect.stringContaining('live-agent-session-'),
      expect.stringContaining('live-agent-session-'),
    ]);

    await user.click(required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-apply"]'));
    await waitFor(() => expect(composer.dataset.livePromptStatus).toBe('applied'));
    expect(required<HTMLElement>(container, '[data-testid="agent-photographer-result"]').dataset.proposalState).toBe(
      'applied',
    );
    expect(container.querySelector('[data-testid="agent-live-prompt-rollback"]')).not.toBeNull();
    await waitFor(() => expect(focusTracker.focus).toHaveBeenCalled());
    focusTracker.focus.mockClear();

    await user.click(required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-rollback"]'));
    await waitFor(() => expect(composer.dataset.livePromptStatus).toBe('rolled_back'));
    expect(required<HTMLElement>(container, '[data-testid="agent-photographer-result"]').dataset.proposalState).toBe(
      'rolled_back',
    );
    await waitFor(() => expect(focusTracker.focus).toHaveBeenCalled());
    focusTracker.restore();
  });

  test('keeps a runtime failure in a concise lifecycle state instead of duplicating chat status messages', async () => {
    useEditorStore.getState().setEditor({ selectedImage: null });
    const { container } = await render(createElement(AgentChatShell, { transcript }));
    const composer = required<HTMLElement>(container, '[data-testid="agent-live-prompt-composer"]');
    const user = userEvent.setup();

    await user.click(quickStart(container, 'Recover highlights'));
    expect(required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-run"]').disabled).toBe(false);
    await user.click(required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-run"]'));
    await waitFor(() => expect(composer.dataset.livePromptStatus).toBe('failed'));

    expect(required<HTMLElement>(container, '[data-testid="agent-live-prompt-error"]').textContent).toContain(
      'Select an image before previewing',
    );
    expect(container.querySelectorAll('[data-testid^="agent-chat-message-"]')).toHaveLength(1);
    expect(required<HTMLElement>(container, '[data-testid="agent-photographer-result"]').className).toContain(
      'overflow-hidden',
    );
  });

  test('cancels an in-flight preview with Escape and restores the composer focus', async () => {
    previewInvokeDelayMs = 250;
    const { container } = await render(createElement(AgentChatShell, { transcript }));
    const composer = required<HTMLElement>(container, '[data-testid="agent-live-prompt-composer"]');
    const input = required<HTMLTextAreaElement>(container, '[data-testid="agent-live-prompt-input"]');
    const focusTracker = trackFocus(input);
    const user = userEvent.setup();

    await user.click(quickStart(container, 'Recover highlights'));
    await user.click(required<HTMLButtonElement>(container, '[data-testid="agent-live-prompt-run"]'));
    await waitFor(() => expect(composer.dataset.livePromptStatus).toBe('previewing'));

    await user.click(input);
    focusTracker.focus.mockClear();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(composer.dataset.livePromptStatus).toBe('cancelled'));

    expect(required<HTMLElement>(container, '[data-testid="agent-photographer-result"]').dataset.proposalState).toBe(
      'cancelled',
    );
    await waitFor(() => expect(focusTracker.focus).toHaveBeenCalled());
    focusTracker.restore();
  });
});

async function render(element: ReactElement) {
  return testingRender(createElement(I18nextProvider, { i18n }, element));
}

function seedEditor() {
  useEditorStore.getState().hydrateEditorRenderAuthority({
    editDocumentV2: initialEditDocumentV2,
    finalPreviewUrl: 'blob:agent-chat-shell-before',
    hasRenderedFirstFrame: true,
    historyCheckpoints: [],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage,
    uncroppedAdjustedPreviewUrl: null,
    history: [initialEditDocumentV2],
  });
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

function trackFocus(element: HTMLElement) {
  const originalFocus = element.focus;
  const focus = mock((options?: FocusOptions) => originalFocus.call(element, options));
  Object.defineProperty(element, 'focus', { configurable: true, value: focus });
  return {
    focus,
    restore: () => {
      Reflect.deleteProperty(element, 'focus');
    },
  };
}

function buildPreviewBytes(): ArrayBuffer {
  const currentImage = useEditorStore.getState().selectedImage;
  return currentImage === null
    ? new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer
    : (() => {
        const currentPreview = getRawEngineImagePreview({ requestId: 'agent-chat-shell-ui-preview' });
        return buildAgentMediumPreviewEncodedBytesForTest({
          graphRevision: currentPreview.receipt.graphRevision,
          imagePath: currentImage.path,
          preview: currentPreview.preview,
        }).buffer;
      })();
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
