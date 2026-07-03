import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { AgentPanel, resolveAgentReviewWorkspaceState } from '../../../src/components/panel/right/ai/AgentPanel.tsx';
import type { SelectedImage } from '../../../src/components/ui/AppProperties.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

const selectedImage: SelectedImage = {
  exif: { ISO: 200 },
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: 'blob:agent-review-original',
  path: '/photos/agent-review-workspace.ARW',
  rawDevelopmentReport: null,
  thumbnailUrl: 'data:image/jpeg;base64,AAAA',
  width: 4500,
};

afterEach(() => {
  if (renderedRoot !== null) {
    act(() => {
      renderedRoot?.root.unmount();
    });
    renderedRoot.container.remove();
    renderedRoot = null;
  }
  resetEditorStore();
});

describe('agent panel preview-review workspace', () => {
  test('resolves stable review states for no-selection, preview, approval, applied, blocked, and audit', () => {
    expect(
      resolveAgentReviewWorkspaceState({
        hasAppliedEdit: false,
        hasPreviewReceipt: false,
        selectedImage: null,
      }),
    ).toMatchObject({
      applied: false,
      'approval-required': false,
      'audit-persisted': false,
      blocked: true,
      'dry-run-ready': false,
      'no-selection': true,
      'preview-ready': false,
    });

    expect(
      resolveAgentReviewWorkspaceState({
        hasAppliedEdit: true,
        hasPreviewReceipt: true,
        selectedImage,
      }),
    ).toMatchObject({
      applied: true,
      'approval-required': true,
      'audit-persisted': true,
      blocked: false,
      'dry-run-ready': true,
      'no-selection': false,
      'preview-ready': true,
    });
  });

  test('renders dense first-screen evidence before the lower transcript in a selected-image rail', async () => {
    resetEditorStore();
    useEditorStore.getState().setEditor({
      finalPreviewUrl: 'data:image/jpeg;base64,BBBB',
      historyIndex: 1,
      selectedImage,
    });

    const { container } = await renderAgentPanel();

    expect(required(container, 'agent-review-workspace').className).toContain('space-y-2');
    expect(required(container, 'agent-review-workspace-header').textContent).toContain('Agent Review');
    expect(required(container, 'agent-preview-receipt-card').dataset.previewReady).toBe('true');
    expect(required(container, 'agent-review-state-no-selection').dataset.state).toBe('inactive');
    expect(required(container, 'agent-review-state-preview-ready').dataset.state).toBe('active');
    expect(required(container, 'agent-review-state-dry-run-ready').dataset.state).toBe('active');
    expect(required(container, 'agent-review-state-approval-required').dataset.state).toBe('active');
    expect(required(container, 'agent-review-state-applied').dataset.state).toBe('active');
    expect(required(container, 'agent-review-state-audit-persisted').dataset.state).toBe('active');
    expect(required(container, 'agent-tool-readiness-chip-row').textContent).toContain('Dry-runs');
    expect(required(container, 'agent-dry-run-apply-review-controls').dataset.approvalRequired).toBe('true');
    expect((required(container, 'agent-review-control-apply') as HTMLButtonElement).disabled).toBe(false);
    expect(required(container, 'agent-review-live-activity-timeline').textContent).toContain('Current image context');

    const workspace = required(container, 'agent-review-workspace');
    const transcript = required(container, 'agent-review-transcript-lower');
    expect([...workspace.children].indexOf(transcript)).toBeGreaterThan(4);
  });

  test('keeps blocked no-selection state visible with controls disabled', async () => {
    const { container } = await renderAgentPanel();

    expect(required(container, 'agent-right-rail-panel').dataset.reviewWorkspaceState).toBe('blocked');
    expect(required(container, 'agent-review-state-no-selection').dataset.state).toBe('active');
    expect(required(container, 'agent-review-state-blocked').dataset.state).toBe('active');
    expect(required(container, 'agent-review-state-preview-ready').dataset.state).toBe('inactive');
    expect((required(container, 'agent-review-control-dry-run') as HTMLButtonElement).disabled).toBe(true);
    expect((required(container, 'agent-review-control-apply') as HTMLButtonElement).disabled).toBe(true);
    expect(required(container, 'agent-preview-receipt-card').dataset.previewReady).toBe('false');
  });
});

async function renderAgentPanel() {
  if (!globalThis.window) {
    const window = new Window();
    Object.assign(globalThis, {
      document: window.document,
      HTMLButtonElement: window.HTMLButtonElement,
      HTMLDivElement: window.HTMLDivElement,
      HTMLElement: window.HTMLElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      window,
    });
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  renderedRoot = { container, root };

  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n: await createTestI18n() }, createElement(AgentPanel)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return { container, root };
}

async function createTestI18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    resources: { en: { translation: en } },
  });
  return instance;
}

function required(container: HTMLElement, testId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (element === null) throw new Error(`Expected ${testId} to render.`);
  return element;
}

function resetEditorStore() {
  useEditorStore.setState({
    adjustments: INITIAL_ADJUSTMENTS,
    finalPreviewUrl: null,
    history: [INITIAL_ADJUSTMENTS],
    historyCheckpoints: [],
    historyIndex: 0,
    lastBasicToneCommand: null,
    selectedImage: null,
    uncroppedAdjustedPreviewUrl: null,
  });
}
