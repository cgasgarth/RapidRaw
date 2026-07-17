import { afterEach, describe, expect, mock, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { createElement, type ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import {
  editDocumentLayersV2Schema,
  layerStackSidecarV1Schema,
  readLayerStackSidecarsFromSidecar,
} from '../../../packages/rawengine-schema/src';
import { Mask } from '../../../src/components/panel/right/layers/Masks.tsx';
import type { SelectedImage } from '../../../src/components/ui/AppProperties.tsx';
import { ContextMenuProvider } from '../../../src/context/ContextMenuContext.tsx';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import {
  createDefaultMaskEditNodes,
  INITIAL_MASK_ADJUSTMENTS,
  type MaskContainer,
} from '../../../src/utils/adjustments.ts';
import {
  createDefaultEditDocumentV2,
  patchEditDocumentV2Node,
  prepareEditDocumentV2ForPersistence,
} from '../../../src/utils/editDocumentV2.ts';
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

  test('persists local tone edits to an existing typed sidecar and undoes both authorities', async () => {
    const mask = makeMask('mask-native', 'Native mask');
    const masks = editDocumentLayersV2Schema.parse({ masks: [mask] }).masks;
    const sidecar = layerStackSidecarV1Schema.parse({
      graphRevision: 'layer_graph_1',
      layers: [
        {
          adjustmentPreset: 'empty_adjustment_layer_v1',
          adjustments: {
            toneColor: {
              blackPoint: 0,
              clarity: 0,
              contrast: 0,
              exposureEv: 0,
              highlights: 0,
              saturation: 0,
              shadows: 0,
              whitePoint: 0,
            },
          },
          blendMode: 'normal',
          id: mask.id,
          maskIds: [],
          name: mask.name,
          opacity: 1,
          visible: true,
        },
      ],
      schemaVersion: 1,
      sourceImagePath: '/private/alaska.ARW',
      storage: 'sidecar_artifact',
    });
    const editDocumentV2 = {
      ...patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', { masks }),
      extensions: { rawEngineArtifacts: { layerStackSidecars: [sidecar], schemaVersion: 1 } },
    };
    const selectedImage: SelectedImage = {
      exif: null,
      height: 8,
      isRaw: true,
      isReady: true,
      originalUrl: null,
      path: sidecar.sourceImagePath,
      thumbnailUrl: '',
      width: 8,
    };
    useEditorStore.getState().hydrateEditorRenderAuthority({
      activeMaskContainerId: mask.id,
      activeMaskId: null,
      editDocumentV2,
      history: [editDocumentV2],
      historyIndex: 0,
      selectedImage,
    });

    const { container, user } = await renderPanel();
    await user.click(required(container, '[data-testid="mask-adjustments-section-basic-toggle"]'));
    fireEvent.input(required<HTMLInputElement>(container, '[data-testid="basic-control-exposure-range"]'), {
      target: { value: '2' },
    });

    const edited = useEditorStore.getState().editDocumentV2;
    expect(edited.layers.masks[0]?.adjustments['exposure']).toBe(2);
    expect(readLayerStackSidecarsFromSidecar(edited.extensions)[0]?.layers[0]?.adjustments?.toneColor?.exposureEv).toBe(
      2,
    );

    act(() => {
      useEditorStore.getState().undo();
    });
    const undone = useEditorStore.getState().editDocumentV2;
    expect(undone.layers.masks[0]?.adjustments['exposure']).toBe(0);
    expect(readLayerStackSidecarsFromSidecar(undone.extensions)[0]?.layers[0]?.adjustments?.toneColor?.exposureEv).toBe(
      0,
    );
  });

  test('projects source artifacts out of native layer adjustments before save', () => {
    const mask = makeMask('mask-projection', 'Projection');
    const parsedMask = editDocumentLayersV2Schema.parse({ masks: [mask] }).masks[0];
    if (parsedMask === undefined) throw new Error('Expected projection mask.');
    const contaminatedMask = {
      ...parsedMask,
      adjustments: { ...parsedMask.adjustments, aiPatches: [] },
    };
    const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'layers', {
      masks: [contaminatedMask],
    });

    const persisted = prepareEditDocumentV2ForPersistence(editDocumentV2);
    expect(persisted.layers.masks[0]?.adjustments).not.toHaveProperty('aiPatches');
    expect(persisted.layers.masks[0]?.adjustments['exposure']).toBe(0);
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
