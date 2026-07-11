import { afterEach, describe, expect, mock, test } from 'bun:test';

import { Panel } from '../../../src/components/ui/AppProperties';
import {
  areEditorWorkspaceViewportsEqual,
  classifyEditorWorkspaceViewport,
} from '../../../src/hooks/viewport/useEditorWorkspaceViewportSubscription';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { useUIStore } from '../../../src/store/useUIStore';
import { createDefaultEditorWorkspacePreferences } from '../../../src/utils/editorWorkspacePreferences';
import { ownsMaskControlHover } from '../../../src/utils/maskControlHoverOwnership';

const desktop = classifyEditorWorkspaceViewport(1440, 900);
const compact = classifyEditorWorkspaceViewport(800, 1000);

const resetStores = () => {
  const preferences = createDefaultEditorWorkspacePreferences();
  useUIStore.setState({
    activeRightPanel: Panel.Color,
    editorWorkspacePreferences: preferences,
    editorWorkspaceViewport: desktop,
    renderedRightPanel: Panel.Color,
  });
  useEditorStore.setState({
    activeAiPatchContainerId: null,
    activeAiSubMaskId: null,
    activeMaskContainerId: null,
    activeMaskId: null,
    isMaskControlHovered: false,
    isWbPickerActive: false,
  });
};

afterEach(resetStores);

describe('editor workspace viewport transitions', () => {
  test('classifies rounded canonical snapshots and compares every semantic field', () => {
    expect(classifyEditorWorkspaceViewport(800.4, 1000.4)).toEqual({
      height: 1000,
      isCompactPortrait: true,
      isPortrait: true,
      width: 800,
    });
    expect(classifyEditorWorkspaceViewport(1000, 800)).toEqual({
      height: 800,
      isCompactPortrait: false,
      isPortrait: false,
      width: 1000,
    });
    expect(areEditorWorkspaceViewportsEqual(desktop, { ...desktop })).toBe(true);
    expect(areEditorWorkspaceViewportsEqual(desktop, { ...desktop, isPortrait: true })).toBe(false);
  });

  test('suppresses equivalent viewport writes', () => {
    resetStores();
    const listener = mock(() => undefined);
    const unsubscribe = useUIStore.subscribe(listener);

    useUIStore.getState().setEditorWorkspaceViewport({ ...desktop });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  test('routes Presets directly to the owning surface in each viewport class', () => {
    resetStores();
    useUIStore.getState().selectEditorPanel(Panel.Presets, desktop);
    let state = useUIStore.getState();
    expect(state.activeRightPanel).toBeNull();
    expect(state.renderedRightPanel).toBe(Panel.Presets);
    expect(state.editorWorkspacePreferences.leftSidebar).toMatchObject({ visible: true });
    expect(state.editorWorkspacePreferences.leftSidebar.expandedSections).toContain('presets');

    useUIStore.getState().selectEditorPanel(Panel.Presets, compact);
    state = useUIStore.getState();
    expect(state.activeRightPanel).toBe(Panel.Presets);
    expect(state.renderedRightPanel).toBe(Panel.Presets);
  });

  test('relocates active compact Presets atomically when crossing to desktop', () => {
    resetStores();
    useUIStore.getState().setEditorWorkspaceViewport(compact);
    useUIStore.getState().selectEditorPanel(Panel.Presets, compact);

    const observed: Array<{ panel: Panel | null; viewportIsCompact: boolean }> = [];
    const unsubscribe = useUIStore.subscribe((state) => {
      observed.push({
        panel: state.activeRightPanel,
        viewportIsCompact: state.editorWorkspaceViewport.isCompactPortrait,
      });
    });
    useUIStore.getState().setEditorWorkspaceViewport(desktop);
    unsubscribe();

    expect(observed).toEqual([{ panel: null, viewportIsCompact: false }]);
    expect(useUIStore.getState().editorWorkspacePreferences.leftSidebar.expandedSections).toContain('presets');
  });

  test('clears mask hover and transient tool ownership in the panel command', () => {
    resetStores();
    useEditorStore.setState({
      activeAiSubMaskId: 'ai-submask',
      activeMaskContainerId: 'mask-container',
      activeMaskId: 'mask',
      isMaskControlHovered: true,
      isWbPickerActive: true,
    });
    useUIStore.getState().selectEditorPanel(Panel.Metadata, desktop);

    expect(useEditorStore.getState()).toMatchObject({
      activeAiSubMaskId: null,
      activeMaskId: null,
      isMaskControlHovered: false,
      isWbPickerActive: false,
    });
  });

  test('defines mask-control hover ownership by both panel and active container', () => {
    expect(
      ownsMaskControlHover({
        activeAiPatchContainerId: null,
        activeMaskContainerId: 'mask',
        activeRightPanel: Panel.Masks,
      }),
    ).toBe(true);
    expect(
      ownsMaskControlHover({
        activeAiPatchContainerId: 'ai-patch',
        activeMaskContainerId: null,
        activeRightPanel: Panel.Ai,
      }),
    ).toBe(true);
    expect(
      ownsMaskControlHover({
        activeAiPatchContainerId: null,
        activeMaskContainerId: 'mask',
        activeRightPanel: Panel.Metadata,
      }),
    ).toBe(false);
    expect(
      ownsMaskControlHover({
        activeAiPatchContainerId: null,
        activeMaskContainerId: null,
        activeRightPanel: Panel.Masks,
      }),
    ).toBe(false);
  });
});
