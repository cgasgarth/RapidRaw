import { afterEach, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';

import { EditorSnapshotsSection } from '../../../src/components/panel/editor/EditorHistorySections';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import { readNamedSnapshots, snapshotDocumentEquals } from '../../../src/utils/editorNamedSnapshots';

const imagePath = '/private/Alaska/DSC0001.ARW';

afterEach(() => {
  act(() => {
    useEditorStore.getState().applyEditorTeardownTransaction({
      adjustmentRevision: useEditorStore.getState().adjustmentRevision,
      imageSessionId:
        useEditorStore.getState().imageSession?.id ??
        `editor-image-session:${String(useEditorStore.getState().imageSessionId)}`,
      path: useEditorStore.getState().selectedImage?.path ?? '',
      transactionId: `test-teardown:${String(Date.now())}`,
    });
  });
});

test('named snapshots capture typed documents, reject duplicate/empty labels, and restore undoably', () => {
  const initial = createDefaultEditDocumentV2();
  const edited = patchEditDocumentV2Node(initial, 'scene_global_color_tone', { exposure: 1 });
  act(() => {
    useEditorStore.getState().setEditor({
      imageSession: { generation: 1, id: 'session-1', path: imagePath, source: 'cache', status: 'ready' },
      selectedImage: {
        exif: null,
        height: 100,
        isRaw: true,
        isReady: true,
        originalUrl: null,
        path: imagePath,
        thumbnailUrl: '',
        width: 100,
      },
    });
    useEditorStore
      .getState()
      .hydrateEditorRenderAuthority({ editDocumentV2: edited, history: [edited], historyIndex: 0 });
  });

  expect(useEditorStore.getState().createNamedSnapshot('')).toBe(false);
  expect(useEditorStore.getState().createNamedSnapshot('Look')).toBe(true);
  expect(useEditorStore.getState().createNamedSnapshot('look')).toBe(false);

  const snapshot = readNamedSnapshots(
    useEditorStore.getState().editDocumentV2,
    imagePath,
    `editor-image-source:${imagePath}`,
  )[0];
  expect(snapshot).toBeDefined();
  expect(Object.hasOwn(snapshot?.editDocumentV2.extensions ?? {}, 'rawengineNamedSnapshots')).toBe(false);

  const beforeRestore = patchEditDocumentV2Node(useEditorStore.getState().editDocumentV2, 'scene_global_color_tone', {
    exposure: -1,
  });
  act(() => {
    useEditorStore.getState().applyEditTransaction({
      baseAdjustmentRevision: useEditorStore.getState().adjustmentRevision,
      history: 'single-entry',
      imageSessionId: 'session-1',
      operations: [{ editDocumentV2: beforeRestore, type: 'replace-edit-document' }],
      persistence: 'commit',
      source: 'manual-control',
      transactionId: 'test-edit',
    });
  });
  expect(snapshot && useEditorStore.getState().restoreNamedSnapshot(snapshot.id)).toBe(true);
  if (!snapshot) throw new Error('Expected a named snapshot.');
  expect(snapshotDocumentEquals(useEditorStore.getState().editDocumentV2, snapshot.editDocumentV2)).toBe(true);
  expect(useEditorStore.getState().history.length).toBe(3);
  useEditorStore.getState().undo();
  expect(snapshotDocumentEquals(useEditorStore.getState().editDocumentV2, beforeRestore)).toBe(true);
});

test('rename and delete operate on the source-image snapshot authority', () => {
  const state = useEditorStore.getState();
  act(() => {
    state.setEditor({
      imageSession: { generation: 2, id: 'session-2', path: imagePath, source: 'cache', status: 'ready' },
      selectedImage: {
        exif: null,
        height: 100,
        isRaw: true,
        isReady: true,
        originalUrl: null,
        path: imagePath,
        thumbnailUrl: '',
        width: 100,
      },
    });
    const document = createDefaultEditDocumentV2();
    state.hydrateEditorRenderAuthority({ editDocumentV2: document, history: [document], historyIndex: 0 });
  });
  expect(state.createNamedSnapshot('Base')).toBe(true);
  const snapshot = readNamedSnapshots(
    useEditorStore.getState().editDocumentV2,
    imagePath,
    `editor-image-source:${imagePath}`,
  )[0];
  if (!snapshot) throw new Error('Expected a named snapshot.');
  expect(state.renameNamedSnapshot(snapshot.id, 'Renamed')).toBe(true);
  expect(state.renameNamedSnapshot(snapshot.id, ' ')).toBe(false);
  expect(state.deleteNamedSnapshot(snapshot.id)).toBe(true);
  expect(
    readNamedSnapshots(useEditorStore.getState().editDocumentV2, imagePath, `editor-image-source:${imagePath}`),
  ).toHaveLength(0);
});

test('named snapshot rail reads snapshots from the source-image authority during an active session', () => {
  act(() => {
    useEditorStore.getState().setEditor({
      imageSession: { generation: 3, id: 'session-3', path: imagePath, source: 'cache', status: 'ready' },
      selectedImage: {
        exif: null,
        height: 100,
        isRaw: true,
        isReady: true,
        originalUrl: null,
        path: imagePath,
        thumbnailUrl: '',
        width: 100,
      },
    });
    const document = createDefaultEditDocumentV2();
    useEditorStore
      .getState()
      .hydrateEditorRenderAuthority({ editDocumentV2: document, history: [document], historyIndex: 0 });
  });

  expect(useEditorStore.getState().createNamedSnapshot('Saved look')).toBe(true);
  const container = render(<EditorSnapshotsSection />).container;
  expect(container.querySelector('[role="option"]')?.textContent).toBe('Saved look');
  expect(container.querySelector('[data-testid="editor-sidebar-snapshot-active-row"]')).not.toBeNull();
});
