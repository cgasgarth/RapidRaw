import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { createElement, type ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { editDocumentLayersV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2.ts';
import { ContextMenuProvider } from '../../../src/context/ContextMenuContext.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import {
  createDefaultMaskEditNodes,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
} from '../../../src/utils/adjustments.ts';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2.ts';
import {
  createMaskShellAuthority,
  isMaskShellAuthorityCurrent,
  nextMaskCompositionMode,
  readMaskShellStatus,
} from '../../../src/utils/mask/lightroomMaskShell.ts';

mock.module('@clerk/react', () => ({
  ClerkProvider: ({ children }: { children?: ReactNode }) => children ?? null,
  Show: ({ children }: { children?: ReactNode }) => children ?? null,
  SignIn: () => null,
  useAuth: () => ({ getToken: async () => null }),
  useClerk: () => ({ signOut: async () => undefined }),
  useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
}));
mock.module('@tauri-apps/api/core', () => ({ invoke: mock(async () => []) }));

const makeMask = (id: string): MaskContainer => ({
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  editNodes: createDefaultMaskEditNodes(),
  editNodeSchemaVersion: 1,
  id,
  invert: false,
  name: id,
  opacity: 100,
  subMasks: [],
  visible: true,
});

afterEach(() => {
  const editDocumentV2 = createDefaultEditDocumentV2();
  act(() => {
    useEditorStore.getState().hydrateEditorRenderAuthority({
      activeMaskContainerId: null,
      activeMaskId: null,
      editDocumentV2,
      history: [editDocumentV2],
      historyIndex: 0,
      selectedImage: null,
    });
  });
});

describe('Lightroom mask shell authority and composition', () => {
  test('rejects a response from a replaced image session or source revision', () => {
    const authority = createMaskShellAuthority({
      imageSessionId: 'image-a',
      maskId: 'mask-a',
      sourceIdentity: '/private/alaska.ARW',
      sourceRevision: 'revision-1',
    });
    expect(isMaskShellAuthorityCurrent(authority, { ...authority })).toBe(true);
    expect(isMaskShellAuthorityCurrent(authority, { ...authority, imageSessionId: 'image-b' })).toBe(false);
    expect(isMaskShellAuthorityCurrent(authority, { ...authority, sourceRevision: 'revision-2' })).toBe(false);
  });

  test('keeps the explicit composition grammar and typed status values', () => {
    expect(nextMaskCompositionMode('add')).toBe('subtract');
    expect(nextMaskCompositionMode('subtract')).toBe('intersect');
    expect(nextMaskCompositionMode('intersect')).toBe('add');
    expect(readMaskShellStatus({ maskShellStatus: 'pending' })).toBe('pending');
    expect(readMaskShellStatus({ errorMessage: 'provider failed' })).toBe('error');
    expect(readMaskShellStatus({ unavailableReason: 'model not installed' })).toBe('unavailable');
  });

  test('renders one focused list with explicit composition actions and truthful overlay controls', async () => {
    const masks = editDocumentLayersV2Schema.parse({ masks: [makeMask('mask-shell')] }).masks;
    const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', { masks });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      activeMaskContainerId: 'mask-shell',
      activeMaskId: null,
      editDocumentV2,
      history: [editDocumentV2],
      historyIndex: 0,
      selectedImage: null,
    });

    const i18n = i18next.createInstance();
    await i18n.use(initReactI18next).init({
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      lng: 'en',
      resources: { en: { translation: en } },
    });
    const { MasksPanel } = await import('../../../src/components/panel/right/layers/MasksPanel.tsx');
    const user = userEvent.setup();
    const { container } = render(
      createElement(I18nextProvider, { i18n }, createElement(ContextMenuProvider, null, createElement(MasksPanel))),
    );

    const row = container.querySelector<HTMLDivElement>('[data-testid="mask-container-row-mask-shell"]');
    if (row === null) throw new Error('Expected focused mask row.');
    await user.click(row);

    const subtract = container.querySelector<HTMLButtonElement>('[data-testid="mask-composition-subtract"]');
    if (subtract === null) throw new Error('Expected explicit subtract action.');
    await user.click(subtract);
    expect(useEditorStore.getState().editDocumentV2.layers.masks[0]?.subMasks[0]?.mode).toBe('subtractive');
    expect(container.querySelector('[data-mask-status="current"]')).not.toBeNull();

    const selectedPin = container.querySelector<HTMLInputElement>('#mask-overlay-selected-pin');
    const handles = container.querySelector<HTMLInputElement>('#mask-overlay-handles');
    if (selectedPin === null || handles === null) throw new Error('Expected overlay visibility controls.');
    await user.click(selectedPin);
    await user.click(handles);
    expect(container.querySelector('[data-mask-overlay-selected-pin="false"]')).not.toBeNull();
    expect(container.querySelector('[data-mask-overlay-handles="false"]')).not.toBeNull();
  });
});
