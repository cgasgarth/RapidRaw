import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
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
  INITIAL_ADJUSTMENTS,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
} from '../../../src/utils/adjustments.ts';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2.ts';

mock.module('@clerk/react', () => ({
  ClerkProvider: ({ children }: { children?: ReactNode }) => children ?? null,
  Show: ({ children }: { children?: ReactNode }) => children ?? null,
  SignIn: () => null,
  useAuth: () => ({ getToken: async () => null }),
  useClerk: () => ({ signOut: async () => undefined }),
  useUser: () => ({ isLoaded: true, isSignedIn: false, user: null }),
}));
const invoke = mock(async (command: string) => (command === 'load_presets' ? [] : null));
mock.module('@tauri-apps/api/core', () => ({ invoke }));

const firstMask: MaskContainer = {
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  editNodes: createDefaultMaskEditNodes(),
  editNodeSchemaVersion: 1,
  id: 'mask-first',
  invert: false,
  name: 'Sky recovery',
  opacity: 100,
  subMasks: [],
  visible: true,
};

const secondMask: MaskContainer = {
  adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
  editNodes: createDefaultMaskEditNodes(),
  editNodeSchemaVersion: 1,
  id: 'mask-second',
  invert: false,
  name: 'Foreground lift',
  opacity: 100,
  subMasks: [],
  visible: true,
};

afterEach(() => {
  const editDocumentV2 = createDefaultEditDocumentV2();
  act(() => {
    useEditorStore.getState().hydrateEditorRenderAuthority({
      activeMaskContainerId: null,
      activeMaskId: null,
      historyIndex: 0,
      selectedImage: null,
      editDocumentV2,
      history: [editDocumentV2],
    });
  });
  invoke.mockClear();
});

describe('compact masks panel workflow', () => {
  test('commits first creation selection and reset without a repair pass', async () => {
    const editDocumentV2 = createDefaultEditDocumentV2();
    useEditorStore.getState().hydrateEditorRenderAuthority({
      historyIndex: 0,
      selectedImage: null,
      editDocumentV2,
      history: [editDocumentV2],
    });

    const { container, user } = await renderMasksPanel();
    expect(container.textContent).not.toContain('Mask Adjustments');

    await clickControl(user, container, '[data-testid="mask-creation-linear"]');

    const stateAfterCreate = useEditorStore.getState();
    const createdContainer = stateAfterCreate.editDocumentV2.layers.masks[0];
    const createdSubMask = createdContainer?.subMasks[0];
    expect(stateAfterCreate.activeMaskContainerId).toBe(createdContainer?.id ?? null);
    expect(stateAfterCreate.activeMaskId).toBe(createdSubMask?.id ?? null);

    await clickControl(user, container, '[data-testid="mask-reset-all"]');
    expect(useEditorStore.getState().editDocumentV2.layers.masks).toHaveLength(0);
    expect(useEditorStore.getState().activeMaskContainerId).toBeNull();
    expect(useEditorStore.getState().activeMaskId).toBeNull();
  });

  test('keeps create, select, visibility, keyboard, and context-menu commands bound to the mask state', async () => {
    const masks = editDocumentLayersV2Schema.parse({
      masks: [firstMask, secondMask].map((mask) => ({ ...mask, adjustments: {} })),
    }).masks;
    const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', { masks });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      activeMaskContainerId: secondMask.id,
      activeMaskId: null,
      historyIndex: 0,
      selectedImage: null,
      editDocumentV2,
      history: [editDocumentV2],
    });

    const { container, user } = await renderMasksPanel();
    const firstRow = required<HTMLElement>(container, '[data-testid="mask-container-row-mask-first"]');
    const secondRow = required<HTMLElement>(container, '[data-testid="mask-container-row-mask-second"]');
    const initialActiveContainerId = useEditorStore.getState().activeMaskContainerId;
    if (initialActiveContainerId === null) throw new Error('Expected the mask panel to select an initial mask.');

    expect(required<HTMLElement>(container, '[data-testid="mask-panel-mask-count"]').textContent).toBe('2');
    expect(required<HTMLElement>(container, '[data-testid="mask-stack-count"]').textContent).toBe('2');
    expect(
      required<HTMLElement>(container, `[data-testid="mask-container-row-${initialActiveContainerId}"]`).dataset[
        'maskContainerActive'
      ],
    ).toBe('true');
    expect(firstRow.dataset['maskContainerVisible']).toBe('true');

    await clickControl(user, container, '[data-testid="mask-contextual-create-brush"]');

    const activeContainer = useEditorStore
      .getState()
      .editDocumentV2.layers.masks.find((mask) => mask.id === initialActiveContainerId);
    const createdSubMask = activeContainer?.subMasks[0];
    expect(createdSubMask?.type).toBe(Mask.Brush);
    expect(useEditorStore.getState().activeMaskContainerId).toBe(initialActiveContainerId);
    expect(useEditorStore.getState().activeMaskId).toBe(createdSubMask?.id ?? null);
    expect(
      required<HTMLElement>(container, `[data-testid="mask-submask-row-${createdSubMask?.id ?? ''}"]`).dataset[
        'maskSubmaskActive'
      ],
    ).toBe('true');

    const revisionBeforeVisibility = useEditorStore.getState().adjustmentRevision;
    await user.click(required<HTMLButtonElement>(firstRow, '[aria-label="Hide Mask"]'));

    expect(useEditorStore.getState().editDocumentV2.layers.masks[0]?.visible).toBe(false);
    expect(firstRow.dataset['maskContainerVisible']).toBe('false');
    expect(useEditorStore.getState().adjustmentRevision).toBe(revisionBeforeVisibility + 1);
    expect(
      editDocumentLayersV2Schema.parse(useEditorStore.getState().editDocumentV2.nodes['layers']?.params).masks[0]
        ?.visible,
    ).toBe(false);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      persistence: 'commit',
      source: 'layer-command',
    });

    const disclosure = required<HTMLButtonElement>(secondRow, 'button[aria-label^="Collapse"]');
    await user.click(disclosure);
    expect(secondRow.getAttribute('aria-expanded')).toBe('false');

    act(() => {
      useEditorStore.getState().undo();
    });
    expect(useEditorStore.getState().editDocumentV2.layers.masks[0]?.visible).toBe(true);
    expect(
      editDocumentLayersV2Schema.parse(useEditorStore.getState().editDocumentV2.nodes['layers']?.params).masks[0]
        ?.visible,
    ).toBe(true);
    expect(secondRow.getAttribute('aria-expanded')).toBe('false');

    fireEvent.keyDown(firstRow, { key: 'Enter' });

    expect(useEditorStore.getState().activeMaskContainerId).toBe(firstMask.id);
    expect(firstRow.getAttribute('aria-current')).toBe('true');

    fireEvent.keyDown(secondRow, { key: 'Enter' });

    expect(useEditorStore.getState().activeMaskContainerId).toBe(secondMask.id);
    expect(useEditorStore.getState().activeMaskId).toBeNull();
    expect(secondRow.getAttribute('aria-current')).toBe('true');

    fireEvent.contextMenu(secondRow, { clientX: 16, clientY: 16 });

    const duplicate = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((button) =>
      button.textContent?.includes('Duplicate Mask'),
    );
    if (duplicate === undefined) throw new Error('Expected Duplicate Mask in the mask context menu.');

    await user.click(duplicate);

    expect(useEditorStore.getState().editDocumentV2.layers.masks).toHaveLength(3);
    expect(required<HTMLElement>(container, '[data-testid="mask-stack-count"]').textContent).toBe('3');
  });
});

async function renderMasksPanel() {
  const i18n = await createTestI18n();
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

async function clickControl(user: UserEvent, container: Element, selector: string) {
  await user.click(required<HTMLButtonElement>(container, selector));
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
