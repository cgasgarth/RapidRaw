import { afterEach, expect, jest, test } from 'bun:test';
import { act, type RenderResult, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { FilmEmulationWorkspace } from '../../../src/components/film/FilmEmulationWorkspace';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import { getFilmBaselineProfileCatalog } from '../../../src/utils/film-look/filmBaselineProfiles';
import { REFERENCE_FILM_PROFILE_REF } from '../../../src/utils/film-look/filmEmulationOperation';

let rendered: RenderResult | null = null;

afterEach(() => {
  rendered = null;
  globalThis.localStorage?.clear();
  if (jest.isFakeTimers()) jest.useRealTimers();
});

test('Film workspace edits publish one current transaction and reset only Film-owned fields', async () => {
  const container = await renderWorkspace();

  await click(container, 'button[aria-label="Enable film emulation"]');
  const enabled = useEditorStore.getState();
  expect(enabled.editDocumentV2.nodes['film_emulation']!.params['filmEmulation']).toMatchObject({
    enabled: true,
    nodeType: 'film_emulation',
    workingSpace: 'acescg_linear_v1',
  });
  expect(enabled.adjustmentRevision).toBe(1);
  expect(enabled.history).toHaveLength(2);
  expect(enabled.lastEditApplicationReceipt).toMatchObject({
    adjustmentRevision: 1,
    baseAdjustmentRevision: 0,
    changedKeys: ['filmEmulation'],
    source: 'film-workspace',
  });
  expect(enabled.editDocumentV2.nodes['film_emulation']!.params['filmEmulation']).toEqual(
    enabled.editDocumentV2.nodes['film_emulation']!.params['filmEmulation'],
  );
  const enabledFilmNode = enabled.editDocumentV2.nodes['film_emulation'];
  if (enabledFilmNode === undefined) throw new Error('Expected enabled Film node.');
  expect(enabledFilmNode.params['filmEmulation']).toEqual(
    enabled.editDocumentV2.nodes['film_emulation']!.params['filmEmulation'],
  );
  expect(enabled.finalPreviewUrl).toBeNull();
  expect(enabled.exportSoftProofTransform).toBeNull();

  await click(container, 'button[aria-label="Enable film emulation"]');
  expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 1, historyIndex: 1 });

  const mix = container.querySelector<HTMLInputElement>('input[aria-label="Film mix"]');
  if (!mix) throw new Error('Expected Film mix range');
  await invokeRangeInteraction(mix, 'onPointerDown');
  expect(useEditorStore.getState().isSliderDragging).toBe(true);
  await invokeRangeInteraction(mix, 'onLostPointerCapture');
  expect(useEditorStore.getState().isSliderDragging).toBe(false);

  const gestureTransactionIds = await dragRange(container, 'input[aria-label="Film mix"]', [90, 70, 50]);
  expect(new Set(gestureTransactionIds).size).toBe(1);
  expect(useEditorStore.getState().isSliderDragging).toBe(false);
  expect(useEditorStore.getState()).toMatchObject({
    adjustmentRevision: 4,
    historyIndex: 2,
  });
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'film_emulation').params['filmEmulation']?.mix,
  ).toBe(0.5);
  expect(useEditorStore.getState().history).toHaveLength(3);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    baseAdjustmentRevision: 1,
    adjustmentRevision: 4,
    transactionId: gestureTransactionIds[0],
  });

  const currentProfile = container.querySelector<HTMLElement>('[data-film-profile-id="rapidraw.reference_film.v1"]');
  if (!currentProfile) throw new Error('Expected current Film profile card');
  await click(currentProfile, 'button:not([aria-pressed])');
  const profiled = useEditorStore.getState();
  expect(profiled.editDocumentV2.nodes['film_emulation']!.params['filmEmulation']).toMatchObject({
    mix: 0.5,
    profileRef: REFERENCE_FILM_PROFILE_REF,
  });
  expect(profiled.editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(1.25);
  expect(profiled.adjustmentRevision).toBe(4);
  expect(profiled.history).toHaveLength(3);
  const profiledFilmNode = profiled.editDocumentV2.nodes['film_emulation'];
  if (profiledFilmNode === undefined) throw new Error('Expected profiled Film node.');
  expect(profiledFilmNode.params['filmEmulation']).toEqual(
    profiled.editDocumentV2.nodes['film_emulation']!.params['filmEmulation'],
  );

  const baselineProfile = getFilmBaselineProfileCatalog().find(
    (profile) => profile.profile.id === 'rapidraw.soft_color_negative.v1',
  );
  if (!baselineProfile) throw new Error('Expected pinned baseline Film profile');
  const baselineCard = container.querySelector<HTMLElement>(`[data-film-profile-id="${baselineProfile.profile.id}"]`);
  if (!baselineCard) throw new Error('Expected baseline Film profile card');
  await click(baselineCard, 'button:not([aria-pressed])');
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'film_emulation').params['filmEmulation']
      ?.profileRef,
  ).toEqual(baselineProfile.model.profileRef);
  expect(useEditorStore.getState().editDocumentV2).not.toHaveProperty('filmLookId');
  expect(useEditorStore.getState().editDocumentV2).not.toHaveProperty('filmLookStrength');

  const historyBeforeReset = useEditorStore.getState().history.length;
  await click(container, 'button[aria-label="Reset film emulation"]');
  const reset = useEditorStore.getState();
  expect(reset.editDocumentV2.nodes['film_emulation']!.params['filmEmulation']).toBeNull();
  expect(reset.editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(1.25);
  expect(reset.editDocumentV2.nodes['color_presence']!.params['saturation']).toBe(INITIAL_ADJUSTMENTS.saturation);
  expect(reset.history).toHaveLength(historyBeforeReset + 1);
  expect(reset.adjustmentRevision).toBe(6);
  const resetFilmNode = reset.editDocumentV2.nodes['film_emulation'];
  if (resetFilmNode === undefined) throw new Error('Expected reset Film node.');
  expect(resetFilmNode.params).toEqual({ filmEmulation: null });

  await click(container, 'button[aria-label="Reset film emulation"]');
  expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 6, historyIndex: 4 });
});

test('Film mix unmount releases only the slider interaction it owns', async () => {
  const container = await renderWorkspace();
  const mix = container.querySelector<HTMLInputElement>('input[aria-label="Film mix"]');
  if (!mix) throw new Error('Expected Film mix range');

  await invokeRangeInteraction(mix, 'onPointerDown');
  expect(useEditorStore.getState().isSliderDragging).toBe(true);
  act(() => rendered?.unmount());
  rendered = null;
  expect(useEditorStore.getState().isSliderDragging).toBe(false);

  const secondContainer = await renderWorkspace();
  const secondMix = secondContainer.querySelector<HTMLInputElement>('input[aria-label="Film mix"]');
  if (!secondMix) throw new Error('Expected second Film mix range');
  useEditorStore.getState().setEditor({ isSliderDragging: true });
  await invokeRangeInteraction(secondMix, 'onPointerDown');
  act(() => rendered?.unmount());
  rendered = null;
  expect(useEditorStore.getState().isSliderDragging).toBe(true);
  useEditorStore.getState().setEditor({ isSliderDragging: false });
});

async function renderWorkspace(): Promise<HTMLElement> {
  const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
    exposure: 1.25,
  });
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    exportSoftProofTransform: {
      blackPointCompensation: 'enabled',
      colorManagedTransform: 'display-p3-preview',
      effectiveColorProfile: 'Display P3',
      effectiveRenderingIntent: 'relative_colorimetric',
      policyStatus: 'active',
      policyVersion: 'film-ui-test-v1',
      sourcePrecisionPath: 'preview',
      transformApplied: true,
      transformPolicyFingerprint: 'film-ui-before',
    },
    finalPreviewUrl: 'blob:film-ui-before',
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 12,
    isSliderDragging: false,
    lastEditApplicationReceipt: null,
    editDocumentV2,
    history: [editDocumentV2],
  });
  const translations = i18next.createInstance();
  await translations.use(initReactI18next).init({
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  rendered = render(createElement(I18nextProvider, { i18n: translations }, createElement(FilmEmulationWorkspace)));
  await act(() => Promise.resolve());
  return rendered.container;
}

async function click(container: ParentNode, selector: string): Promise<void> {
  const target = container.querySelector<HTMLButtonElement>(selector);
  if (!target) throw new Error(`Missing Film workspace control: ${selector}`);
  await act(async () => {
    target.click();
    await Promise.resolve();
  });
}

async function dragRange(
  container: ParentNode,
  selector: string,
  values: number[],
  onInteractionState?: () => void,
): Promise<string[]> {
  const target = container.querySelector<HTMLInputElement>(selector);
  if (!target) throw new Error(`Missing Film workspace range: ${selector}`);
  const EventConstructor = target.ownerDocument.defaultView?.Event;
  if (!EventConstructor) throw new Error('Expected browser Event constructor');
  const InputConstructor = target.ownerDocument.defaultView?.HTMLInputElement;
  const valueSetter = InputConstructor
    ? Object.getOwnPropertyDescriptor(InputConstructor.prototype, 'value')?.set
    : undefined;
  if (!valueSetter) throw new Error('Expected browser range value setter');
  const transactionIds: string[] = [];
  await act(async () => {
    invokeReactHandler(target, 'onPointerDown', { currentTarget: target, target });
    await Promise.resolve();
  });
  onInteractionState?.();
  for (const value of values) {
    await act(async () => {
      valueSetter.call(target, String(value));
      target.dispatchEvent(new EventConstructor('input', { bubbles: true }));
      invokeReactHandler(target, 'onChange', { currentTarget: target, target });
      await Promise.resolve();
    });
    onInteractionState?.();
    const transactionId = useEditorStore.getState().lastEditApplicationReceipt?.transactionId;
    if (!transactionId) throw new Error('Expected Film range transaction identity');
    transactionIds.push(transactionId);
  }
  await act(async () => {
    invokeReactHandler(target, 'onPointerUp', { currentTarget: target, target });
    await Promise.resolve();
  });
  onInteractionState?.();
  return transactionIds;
}

async function invokeRangeInteraction(target: HTMLInputElement, handlerName: string): Promise<void> {
  await act(async () => {
    invokeReactHandler(target, handlerName, { currentTarget: target, target });
    await Promise.resolve();
  });
}

function invokeReactHandler(target: HTMLElement, handlerName: string, event: object): void {
  const reactPropsKey = Object.keys(target).find((key) => key.startsWith('__reactProps$'));
  if (!reactPropsKey) throw new Error('Expected React Film range props');
  const props: unknown = Reflect.get(target, reactPropsKey);
  if (typeof props !== 'object' || props === null) throw new Error('Expected React Film range prop object');
  const handler: unknown = Reflect.get(props, handlerName);
  if (typeof handler !== 'function') throw new Error(`Expected React Film range ${handlerName}`);
  handler(event);
}
