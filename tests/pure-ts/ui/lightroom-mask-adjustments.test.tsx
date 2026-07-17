import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { createElement, type ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { editDocumentLayersV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2.ts';
import { Mask } from '../../../src/components/panel/right/layers/Masks.tsx';
import { ContextMenuProvider } from '../../../src/context/ContextMenuContext.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import {
  createDefaultMaskEditNodes,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
} from '../../../src/utils/adjustments.ts';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2.ts';
import { createEditorSubMaskFallback } from '../../../src/utils/editorSubMaskFactory.ts';

mock.module('@clerk/react', () => ({
  ClerkProvider: ({ children }: { children?: ReactNode }) => children ?? null,
  Show: ({ children }: { children?: ReactNode }) => children ?? null,
  SignIn: () => null,
  useAuth: () => ({ getToken: async () => null }),
  useClerk: () => ({ signOut: async () => undefined }),
  useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
}));
mock.module('@tauri-apps/api/core', () => ({ invoke: mock(async () => []) }));

const makeMask = (id: string, name: string): MaskContainer => ({
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  editNodes: createDefaultMaskEditNodes(),
  editNodeSchemaVersion: 1,
  id,
  invert: false,
  name,
  opacity: 100,
  subMasks: [createEditorSubMaskFallback(Mask.Brush)],
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

describe('Lightroom-style local mask adjustment stack', () => {
  test('renders the familiar local order and keeps Curves behind Advanced', async () => {
    const masks = editDocumentLayersV2Schema.parse({
      masks: [makeMask('mask-tone', 'Tone'), makeMask('mask-color', 'Color')],
    }).masks;
    const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', { masks });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      activeMaskContainerId: masks[0]?.id ?? null,
      activeMaskId: masks[0]?.subMasks[0]?.id ?? null,
      editDocumentV2,
      history: [editDocumentV2],
      historyIndex: 0,
      selectedImage: null,
    });

    const { container, user } = await renderPanel();
    const toggles = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid^="mask-adjustments-"][data-testid$="-toggle"]'),
    ).map((button) => button.dataset['testid']);
    expect(toggles).toEqual([
      'mask-adjustments-section-basic-toggle',
      'mask-adjustments-section-color-toggle',
      'mask-adjustments-section-details-toggle',
      'mask-adjustments-section-effects-toggle',
      'mask-adjustments-advanced-toggle',
      'mask-adjustments-section-curves-toggle',
    ]);
    expect(
      container.querySelector('[data-testid="mask-local-adjustment-stack"]')?.getAttribute('data-adjustment-order'),
    ).toBe('tone-presence,color,detail,effects');

    await user.click(required(container, '[data-testid="mask-adjustments-advanced-toggle"]'));
    expect(required(container, '[data-testid="mask-adjustments-advanced-toggle"]').getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  test('rejects a stale slider event after selection switches to another mask', async () => {
    const masks = editDocumentLayersV2Schema.parse({
      masks: [makeMask('mask-first', 'First'), makeMask('mask-second', 'Second')],
    }).masks;
    const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', { masks });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      activeMaskContainerId: masks[0]?.id ?? null,
      activeMaskId: masks[0]?.subMasks[0]?.id ?? null,
      editDocumentV2,
      history: [editDocumentV2],
      historyIndex: 0,
      selectedImage: null,
    });

    const { container, user } = await renderPanel();
    await user.click(required(container, '[data-testid="mask-adjustments-section-basic-toggle"]'));
    const slider = required<HTMLInputElement>(container, '[data-testid="basic-control-exposure-range"]');
    act(() => {
      useEditorStore.getState().setEditor({
        activeMaskContainerId: masks[1]?.id ?? null,
        activeMaskId: masks[1]?.subMasks[0]?.id ?? null,
      });
    });
    fireEvent.change(slider, { target: { value: '2' } });

    const nextMasks = useEditorStore.getState().editDocumentV2.layers.masks;
    expect(nextMasks.find((mask) => mask.id === 'mask-first')?.adjustments['exposure']).toBe(0);
    expect(nextMasks.find((mask) => mask.id === 'mask-second')?.adjustments['exposure']).toBe(0);
  });
});

async function renderPanel() {
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
  return { container, user };
}

function required<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}
