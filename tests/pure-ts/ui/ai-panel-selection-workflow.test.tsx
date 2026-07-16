import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { editDocumentSourceArtifactsV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { Mask, type SubMask, SubMaskMode } from '../../../src/components/panel/right/layers/Masks.tsx';
import { ContextMenuProvider } from '../../../src/context/ContextMenuContext.tsx';
import en from '../../../src/i18n/locales/en.json';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore.ts';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots.ts';
import { type AiPatch, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2.ts';

const invoke = mock(async () => null);
mock.module('@tauri-apps/api/core', () => ({ invoke }));
mock.module('@clerk/react', () => ({
  useAuth: () => ({ getToken: async () => null }),
  useUser: () => ({ isSignedIn: false, user: null }),
}));
const { AIPanel } = await import('../../../src/components/panel/right/ai/AIPanel.tsx');

const target = (id: string): SubMask => ({
  id,
  invert: false,
  mode: SubMaskMode.Additive,
  opacity: 100,
  type: Mask.Brush,
  visible: true,
});

const edit = (id: string, targets: Array<string>): AiPatch => ({
  id,
  invert: false,
  isLoading: false,
  name: id,
  patchData: null,
  prompt: '',
  subMasks: targets.map(target),
  visible: true,
});

const sourcePath = '/test/image.jpg';
const imageSession = createEditorImageSession({ generation: 8, path: sourcePath, source: 'cache' });

afterEach(() => {
  const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
  const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'source_artifacts', {
    aiPatches: editDocumentSourceArtifactsV2Schema.parse({ aiPatches: adjustments.aiPatches }).aiPatches,
  });
  act(() => {
    useEditorStore.getState().hydrateEditorRenderAuthority({
      activeAiPatchContainerId: null,
      activeAiSubMaskId: null,
      adjustmentRevision: 0,
      editDocumentV2,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: null,
      lastEditApplicationReceipt: null,
      selectedImage: null,
      history: [editDocumentV2],
    });
  });
  invoke.mockClear();
});

describe('AI panel command-owned selection', () => {
  test('keeps manual collapse stable and commits adjacent deletion fallback without an Effect', async () => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      aiPatches: [edit('first', ['one', 'middle', 'last']), edit('second', [])],
    };
    const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'source_artifacts', {
      aiPatches: editDocumentSourceArtifactsV2Schema.parse({ aiPatches: adjustments.aiPatches }).aiPatches,
    });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      activeAiPatchContainerId: 'first',
      activeAiSubMaskId: null,
      adjustmentRevision: 0,
      editDocumentV2,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession,
      imageSessionId: imageSession.generation,
      lastEditApplicationReceipt: null,
      selectedImage: {
        exif: null,
        height: 800,
        isRaw: false,
        isReady: true,
        originalUrl: null,
        path: sourcePath,
        thumbnailUrl: '',
        width: 1200,
      },
      history: [editDocumentV2],
    });

    let passiveStoreWrites = 0;
    const unsubscribe = useEditorStore.subscribe(() => {
      passiveStoreWrites += 1;
    });
    const { container, user } = await renderAiPanel();
    unsubscribe();
    expect(passiveStoreWrites).toBe(0);
    const first = required<HTMLElement>(container, '[data-testid="inpaint-edit-first"]');
    expect(container.querySelector('[data-testid="inpaint-target-middle"]')).toBeNull();

    await user.click(required<HTMLButtonElement>(first, 'button'));
    const middle = required<HTMLElement>(container, '[data-testid="inpaint-target-middle"]');
    await user.click(middle);
    expect(useEditorStore.getState().activeAiSubMaskId).toBe('middle');

    await user.click(required<HTMLButtonElement>(first, 'button'));
    expect(required<HTMLButtonElement>(first, 'button').getAttribute('aria-label')).toBe('Expand edit targets');

    act(() => {
      useEditorStore.getState().applyAiEditCommand(({ aiPatches, selection }) => ({
        aiPatches: aiPatches.map((candidate) =>
          candidate.id === 'second' ? { ...candidate, visible: !candidate.visible } : candidate,
        ),
        selection,
      }));
    });
    expect(required<HTMLButtonElement>(first, 'button').getAttribute('aria-label')).toBe('Expand edit targets');
    expect(useEditorStore.getState().activeAiSubMaskId).toBe('middle');

    await user.click(required<HTMLButtonElement>(first, 'button'));
    const reopenedMiddle = required<HTMLElement>(container, '[data-testid="inpaint-target-middle"]');
    const deleteButton = required<HTMLButtonElement>(reopenedMiddle, 'button:last-of-type');
    await user.click(deleteButton);

    const state = useEditorStore.getState();
    expect(state.editDocumentV2.sourceArtifacts.aiPatches[0]?.subMasks.map((subMask) => subMask.id)).toEqual([
      'one',
      'last',
    ]);
    expect(state.activeAiPatchContainerId).toBe('first');
    expect(state.activeAiSubMaskId).toBe('last');
    expect(required<HTMLElement>(container, '[data-testid="inpaint-target-last"]').getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});

async function renderAiPanel() {
  const i18n = await createTestI18n();
  const user = userEvent.setup();
  const { container } = render(
    createElement(I18nextProvider, { i18n }, createElement(ContextMenuProvider, null, createElement(AIPanel))),
  );
  return { container, user };
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Expected ${selector} to render.`);
  return element;
}

async function createTestI18n() {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    resources: { en: { translation: en } },
  });
  return i18n;
}
