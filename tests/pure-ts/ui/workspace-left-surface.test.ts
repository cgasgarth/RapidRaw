import { afterEach, expect, test } from 'bun:test';

import { Panel } from '../../../src/components/ui/AppProperties';
import { useUIStore } from '../../../src/store/useUIStore';
import { createDefaultEditorWorkspacePreferences } from '../../../src/utils/editorWorkspacePreferences';
import {
  createDefaultLibraryWorkspacePreferences,
  LIBRARY_WORKSPACE_PREFERENCES_STORAGE_KEY,
} from '../../../src/utils/libraryWorkspacePreferences';
import { getWorkspaceLeftSurface } from '../../../src/utils/workspaceLeftSurface';

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

afterEach(() => {
  useUIStore.setState({
    activeRightPanel: Panel.Color,
    editorWorkspacePreferences: createDefaultEditorWorkspacePreferences(),
    leftPanelWidth: 256,
    libraryLeftPanelWidth: 256,
    libraryWorkspacePreferences: createDefaultLibraryWorkspacePreferences(),
    uiVisibility: { filmstrip: true, folderTree: true },
  });
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorageDescriptor);
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

test('routes Library and editor left surfaces without mounting a desktop surface on compact shells', () => {
  expect(
    getWorkspaceLeftSurface({ hasRoots: true, hasSelectedImage: false, isAndroid: false, isCompactPortrait: false }),
  ).toBe('library');
  expect(
    getWorkspaceLeftSurface({ hasRoots: false, hasSelectedImage: true, isAndroid: false, isCompactPortrait: false }),
  ).toBe('editor');
  expect(
    getWorkspaceLeftSurface({ hasRoots: true, hasSelectedImage: true, isAndroid: false, isCompactPortrait: true }),
  ).toBeNull();
  expect(
    getWorkspaceLeftSurface({ hasRoots: true, hasSelectedImage: true, isAndroid: true, isCompactPortrait: false }),
  ).toBeNull();
});

test('persists Library and Develop geometry, visibility, and sections independently', () => {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  useUIStore.setState({
    editorWorkspacePreferences: createDefaultEditorWorkspacePreferences(),
    libraryWorkspacePreferences: createDefaultLibraryWorkspacePreferences(),
  });

  useUIStore.getState().setLibraryFolderTreeWidth(344);
  useUIStore.getState().setLibraryFolderTreeVisibility(false);
  useUIStore.getState().setEditorRegionSize('leftSidebar', 304);
  useUIStore.getState().setEditorRegionVisibility('leftSidebar', true);
  useUIStore.getState().setEditorLeftSectionExpanded('history', true);

  const state = useUIStore.getState();
  const persistedLibrary = JSON.parse(storage.getItem(LIBRARY_WORKSPACE_PREFERENCES_STORAGE_KEY) ?? '{}');
  expect(state.libraryWorkspacePreferences.folderTree).toEqual({ visible: false, width: 344 });
  expect(state.editorWorkspacePreferences.leftSidebar).toMatchObject({ visible: true, width: 304 });
  expect(state.editorWorkspacePreferences.leftSidebar.expandedSections).toContain('history');
  expect(persistedLibrary.folderTree).toEqual({ visible: false, width: 344 });

  useUIStore.setState({
    libraryLeftPanelWidth: 256,
    libraryWorkspacePreferences: createDefaultLibraryWorkspacePreferences(),
  });
  useUIStore.getState().hydrateLibraryWorkspacePreferences(true);
  expect(useUIStore.getState().libraryWorkspacePreferences.folderTree).toEqual({ visible: false, width: 344 });

  useUIStore.getState().setLibraryFolderTreeWidth(900);
  expect(useUIStore.getState().libraryLeftPanelWidth).toBe(344);
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
