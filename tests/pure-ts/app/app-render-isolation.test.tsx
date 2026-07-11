import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { useLibraryStore } from '../../../src/store/useLibraryStore';
import { useProcessStore } from '../../../src/store/useProcessStore';
import { useUIStore } from '../../../src/store/useUIStore';

const counts = {
  editor: 0,
  exportPanel: 0,
  folderTree: 0,
  library: 0,
  modalHost: 0,
  router: 0,
  services: 0,
};

function EditorIsland() {
  useEditorStore((state) => state.adjustments.exposure);
  counts.editor += 1;
  return null;
}

function LibraryIsland() {
  useLibraryStore((state) => state.imageList);
  counts.library += 1;
  return null;
}

function ExportIsland() {
  useProcessStore((state) => state.exportState.progress.current);
  counts.exportPanel += 1;
  return null;
}

function FolderTreeIsland() {
  useUIStore((state) => state.libraryLeftPanelWidth);
  counts.folderTree += 1;
  return null;
}

function ModalIsland() {
  useUIStore((state) => state.isCreateFolderModalOpen);
  counts.modalHost += 1;
  return null;
}

function PersistentServices() {
  const mount = useRef(false);
  if (!mount.current) {
    counts.services += 1;
    mount.current = true;
  }
  return null;
}

function WorkspaceRouter() {
  const hasSession = useEditorStore((state) => state.selectedImage !== null);
  counts.router += 1;
  return hasSession ? <EditorIsland /> : <LibraryIsland />;
}

function IsolationHarness() {
  return (
    <>
      <PersistentServices />
      <WorkspaceRouter />
      <ExportIsland />
      <FolderTreeIsland />
      <ModalIsland />
    </>
  );
}

let root: Root;

beforeEach(async () => {
  const window = new Window({ url: 'http://localhost' });
  Object.assign(globalThis, {
    document: window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    navigator: window.navigator,
    window,
  });
  for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] = 0;
  useEditorStore.getState().setEditor((state) => ({
    adjustments: { ...state.adjustments, exposure: -1 },
    selectedImage: null,
  }));
  useProcessStore.getState().setExportState({ progress: { current: -1, total: 100 } });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<IsolationHarness />));
});

afterEach(() => act(() => root.unmount()));

describe('application render islands', () => {
  test('100 adjustment updates commit only the editor domain', async () => {
    await act(async () => {
      useEditorStore.getState().setEditor({
        selectedImage: {
          exif: null,
          is_edited: false,
          is_virtual_copy: false,
          modified: 0,
          path: '/fixture/open.raw',
          rating: 0,
          tags: null,
        },
      });
    });
    const baseline = { ...counts };
    for (let index = 0; index < 100; index += 1) {
      await act(async () => {
        useEditorStore.getState().setEditor((state) => ({
          adjustments: { ...state.adjustments, exposure: index / 100 },
        }));
      });
    }

    expect(counts.library).toBe(baseline.library);
    expect(counts.exportPanel).toBe(baseline.exportPanel);
    expect(counts.folderTree).toBe(baseline.folderTree);
    expect(counts.modalHost).toBe(baseline.modalHost);
    expect(counts.router).toBe(baseline.router);
    expect(counts.editor - baseline.editor).toBe(100);
  });

  test('1,000 thumbnail events do not commit either workspace boundary', async () => {
    const baseline = { ...counts };
    for (let index = 0; index < 1_000; index += 1) {
      await act(async () => {
        useProcessStore.getState().setProcess((state) => ({
          thumbnails: { ...state.thumbnails, [`/fixture/${index}.jpg`]: `thumb:${index}` },
        }));
      });
    }
    expect(counts.editor).toBe(baseline.editor);
    expect(counts.library).toBe(baseline.library);
    expect(counts.router).toBe(baseline.router);
  });

  test('100 export progress events commit no workspace, folder, or modal boundary', async () => {
    const baseline = { ...counts };
    for (let index = 0; index < 100; index += 1) {
      await act(async () => {
        useProcessStore.getState().setExportState({ progress: { current: index, total: 100 } });
      });
    }
    expect(counts.exportPanel - baseline.exportPanel).toBe(100);
    expect(counts.editor).toBe(baseline.editor);
    expect(counts.library).toBe(baseline.library);
    expect(counts.folderTree).toBe(baseline.folderTree);
    expect(counts.modalHost).toBe(baseline.modalHost);
  });

  test('panel resize commits only its panel boundary and keeps services mounted', async () => {
    const baseline = { ...counts };
    for (let index = 0; index < 100; index += 1) {
      await act(async () => {
        useUIStore.getState().setLibraryFolderTreeWidth(240 + index);
      });
    }
    expect(counts.folderTree - baseline.folderTree).toBe(100);
    expect(counts.editor).toBe(baseline.editor);
    expect(counts.library).toBe(baseline.library);
    expect(counts.exportPanel).toBe(baseline.exportPanel);
    expect(counts.modalHost).toBe(baseline.modalHost);
    expect(counts.services).toBe(1);
  });
});
