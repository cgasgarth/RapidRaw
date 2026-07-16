import { afterEach, expect, test } from 'bun:test';
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';

import {
  EditorHistorySection,
  EditorSnapshotsSection,
} from '../../../src/components/panel/editor/EditorHistorySections';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

afterEach(() => {
  act(() => useEditorStore.getState().resetHistory(createDefaultEditDocumentV2()));
});

test('history rows use the real navigation command without duplicating entries', async () => {
  const user = userEvent.setup();
  const initial = structuredClone(INITIAL_ADJUSTMENTS);
  const exposure = { ...initial, exposure: 0.4 };
  const contrast = { ...exposure, contrast: 12 };
  const documents = [initial, exposure, contrast].map(({ contrast: contrastValue, exposure: exposureValue }) =>
    patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      contrast: contrastValue,
      exposure: exposureValue,
    }),
  );
  useEditorStore.getState().hydrateEditorRenderAuthority({
    historyCheckpoints: [],
    historyIndex: 2,
    editDocumentV2: documents[2]!,
    history: documents,
  });
  const container = renderSection(EditorHistorySection);

  expect(container.querySelectorAll('[role="option"]')).toHaveLength(3);
  const first = getRequired<HTMLButtonElement>(container, '[data-history-index="0"]');
  await user.click(first);

  expect(useEditorStore.getState().editDocumentV2).toEqual(documents[0]!);
  expect(useEditorStore.getState().historyIndex).toBe(0);
  expect(container.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);

  const active = getRequired<HTMLButtonElement>(container, '[data-active="true"]');
  active.focus();
  await user.keyboard('{End}');

  expect(useEditorStore.getState().editDocumentV2).toEqual(documents[2]!);
  expect(useEditorStore.getState().historyIndex).toBe(2);
  await waitFor(() => expect(document.activeElement?.getAttribute('data-active')).toBe('true'));
});

test('snapshots expose empty, create, rename, and apply behavior through the store', async () => {
  const user = userEvent.setup();
  const initial = structuredClone(INITIAL_ADJUSTMENTS);
  const exposure = { ...initial, exposure: 0.4 };
  const documents = [initial, exposure].map(({ exposure: exposureValue }) =>
    patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      exposure: exposureValue,
    }),
  );
  useEditorStore.getState().hydrateEditorRenderAuthority({
    historyCheckpoints: [],
    historyIndex: 1,
    editDocumentV2: documents[1]!,
    history: documents,
  });
  const container = renderSection(EditorSnapshotsSection);

  expect(container.querySelector('[data-testid="editor-sidebar-snapshots-empty"]')).not.toBeNull();
  await user.click(getRequired<HTMLButtonElement>(container, '[data-testid="editor-sidebar-snapshot-create"]'));

  expect(useEditorStore.getState().historyCheckpoints).toHaveLength(1);
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(1);

  await user.click(getRequired<HTMLButtonElement>(container, '[data-snapshot-rename]'));
  const input = getRequired<HTMLInputElement>(container, '[data-testid="editor-sidebar-snapshot-name-input"]');
  expect(document.activeElement).toBe(input);
  await user.clear(input);
  await user.type(input, 'Proof candidate{Enter}');

  expect(useEditorStore.getState().historyCheckpoints[0]?.label).toBe('Proof candidate');
  act(() => {
    useEditorStore.getState().goToHistoryIndex(0);
  });
  await user.click(getRequired<HTMLButtonElement>(container, '[role="option"]'));
  expect(useEditorStore.getState().historyIndex).toBe(1);
  expect(useEditorStore.getState().editDocumentV2).toEqual(documents[1]!);
});

function renderSection(component: typeof EditorHistorySection | typeof EditorSnapshotsSection) {
  return render(createElement(component)).container;
}

function getRequired<T extends Element = Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}
