import { afterEach, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { FilmEmulationWorkspace } from '../../../src/components/film/FilmEmulationWorkspace';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { scheduleAdjustmentPersistenceAfterInteraction } from '../../../src/utils/adjustmentPersistence';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let rendered: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (rendered) {
    act(() => rendered?.root.unmount());
    rendered.container.remove();
    rendered = null;
  }
  globalThis.localStorage?.clear();
  if (jest.isFakeTimers()) jest.useRealTimers();
});

test('Film workspace edits publish one current transaction and reset only Film-owned fields', async () => {
  const container = await renderWorkspace();

  await click(container, 'button[aria-label="Enable film emulation"]');
  const enabled = useEditorStore.getState();
  expect(enabled.adjustments.filmEmulation).toMatchObject({
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
  expect(enabled.adjustmentSnapshot.value.filmEmulation).toEqual(enabled.adjustments.filmEmulation);
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

  jest.useFakeTimers();
  const persistedStrengths: number[] = [];
  let persistenceTimer: ReturnType<typeof setTimeout> | null = null;
  const observePersistence = () => {
    const state = useEditorStore.getState();
    const strength = state.adjustments.filmLookStrength;
    persistenceTimer = scheduleAdjustmentPersistenceAfterInteraction(persistenceTimer, state.isSliderDragging, () =>
      persistedStrengths.push(strength),
    );
    if (state.isSliderDragging) {
      jest.runAllTimers();
      expect(persistedStrengths).toEqual([]);
    }
  };
  const gestureTransactionIds = await dragRange(
    container,
    'input[aria-label="Film mix"]',
    [90, 70, 50],
    observePersistence,
  );
  expect(new Set(gestureTransactionIds).size).toBe(1);
  expect(useEditorStore.getState().isSliderDragging).toBe(false);
  expect(persistedStrengths).toEqual([]);
  jest.advanceTimersByTime(50);
  expect(persistedStrengths).toEqual([50]);
  jest.useRealTimers();
  expect(useEditorStore.getState()).toMatchObject({
    adjustmentRevision: 4,
    adjustments: { filmLookStrength: 50 },
    historyIndex: 2,
  });
  expect(useEditorStore.getState().history).toHaveLength(3);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    baseAdjustmentRevision: 1,
    adjustmentRevision: 4,
    transactionId: gestureTransactionIds[0],
  });

  const measuredProfile = container.querySelector<HTMLElement>(
    '[data-film-profile-id="film_look.measured.monochrome_d65.v1"]',
  );
  if (!measuredProfile) throw new Error('Expected measured Film profile card');
  await click(measuredProfile, 'button:not([aria-pressed])');
  const profiled = useEditorStore.getState();
  expect(profiled.adjustments).toMatchObject({
    exposure: 1.25,
    filmEmulation: null,
    filmLookId: 'film_look.measured.monochrome_d65.v1',
    saturation: -75,
  });
  expect(profiled.adjustmentRevision).toBe(5);
  expect(profiled.history).toHaveLength(4);

  const historyBeforeReset = profiled.history.length;
  await click(container, 'button[aria-label="Reset film emulation"]');
  const reset = useEditorStore.getState();
  expect(reset.adjustments).toMatchObject({
    exposure: 1.25,
    filmEmulation: null,
    filmLookId: null,
    filmLookStrength: INITIAL_ADJUSTMENTS.filmLookStrength,
    saturation: INITIAL_ADJUSTMENTS.saturation,
  });
  expect(reset.history).toHaveLength(historyBeforeReset + 1);
  expect(reset.adjustmentRevision).toBe(6);

  await click(container, 'button[aria-label="Reset film emulation"]');
  expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 6, historyIndex: 4 });
});

test('Film mix unmount releases only the slider interaction it owns', async () => {
  const container = await renderWorkspace();
  const mix = container.querySelector<HTMLInputElement>('input[aria-label="Film mix"]');
  if (!mix) throw new Error('Expected Film mix range');

  await invokeRangeInteraction(mix, 'onPointerDown');
  expect(useEditorStore.getState().isSliderDragging).toBe(true);
  act(() => rendered?.root.unmount());
  rendered = null;
  container.remove();
  expect(useEditorStore.getState().isSliderDragging).toBe(false);

  const secondContainer = await renderWorkspace();
  const secondMix = secondContainer.querySelector<HTMLInputElement>('input[aria-label="Film mix"]');
  if (!secondMix) throw new Error('Expected second Film mix range');
  useEditorStore.getState().setEditor({ isSliderDragging: true });
  await invokeRangeInteraction(secondMix, 'onPointerDown');
  act(() => rendered?.root.unmount());
  rendered = null;
  secondContainer.remove();
  expect(useEditorStore.getState().isSliderDragging).toBe(true);
  useEditorStore.getState().setEditor({ isSliderDragging: false });
});

async function renderWorkspace(): Promise<HTMLDivElement> {
  installDom();
  const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 1.25 };
  useEditorStore.setState({
    adjustmentRevision: 0,
    adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments),
    adjustments,
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
    history: [adjustments],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 12,
    isSliderDragging: false,
    lastEditApplicationReceipt: null,
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  rendered = { container, root };
  const translations = i18next.createInstance();
  await translations.use(initReactI18next).init({
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n: translations }, createElement(FilmEmulationWorkspace)));
    await Promise.resolve();
  });
  return container;
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

function installDom(): void {
  if (globalThis.window) return;
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    document: window.document,
    Event: window.Event,
    HTMLElement: window.HTMLElement,
    localStorage: window.localStorage,
    window,
  });
}
