import { useEffect, useRef } from 'react';
import { shouldAllowViewerImageNavigation } from '../../components/panel/editor/viewerInputResolver';
import { ExifOverlay, type ImageFile, Panel } from '../../components/ui/AppProperties';
import { normalizeKeyboardShortcutMap } from '../../schemas/keyboardShortcutSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import type { EditorZoomCommand } from '../../utils/editorZoom';
import { KEYBIND_DEFINITIONS, normalizeCombo } from '../../utils/keyboardUtils';
import { useEditorActions } from '../editor/useEditorActions';
import { useLibraryActions } from '../library/useLibraryActions';

interface KeyboardShortcutsProps {
  sortedImageList: Array<ImageFile>;
  handleBackToLibrary: () => void;
  handleDeleteSelected: () => void;
  handleImageSelect: (path: string) => void;
  handlePasteFiles: (str: string) => void;
  handleToggleFullScreen: () => void;
  handleZoomChange: (command: EditorZoomCommand) => void;
}

interface KeyboardStoreState {
  editor: ReturnType<typeof useEditorStore.getState>;
  library: ReturnType<typeof useLibraryStore.getState>;
  process: ReturnType<typeof useProcessStore.getState>;
  settings: ReturnType<typeof useSettingsStore.getState>;
  ui: ReturnType<typeof useUIStore.getState>;
}

interface ShortcutAction {
  execute: (event: KeyboardEvent, state: KeyboardStoreState) => void;
  shouldFire?: (state: KeyboardStoreState) => boolean;
}

interface BuiltinShortcut {
  execute: (event: KeyboardEvent, state: KeyboardStoreState) => void;
  match: (event: KeyboardEvent, state: KeyboardStoreState) => boolean;
}

const KEYBIND_ACTIONS = new Set(KEYBIND_DEFINITIONS.map((definition) => definition.action));

export const useKeyboardShortcuts = ({
  sortedImageList,
  handleBackToLibrary,
  handleDeleteSelected,
  handleImageSelect,
  handlePasteFiles,
  handleToggleFullScreen,
  handleZoomChange,
}: KeyboardShortcutsProps) => {
  const { handleRotate, handleCopyAdjustments, handlePasteAdjustments } = useEditorActions();
  const { handleRate, handleSetColorLabel } = useLibraryActions();

  const sortedListRef = useRef(sortedImageList);
  useEffect(() => {
    sortedListRef.current = sortedImageList;
  }, [sortedImageList]);

  useEffect(() => {
    const getStoreState = (): KeyboardStoreState => ({
      editor: useEditorStore.getState(),
      library: useLibraryStore.getState(),
      ui: useUIStore.getState(),
      settings: useSettingsStore.getState(),
      process: useProcessStore.getState(),
    });

    const comboMap = new Map<string, string>();
    const keybinds = normalizeKeyboardShortcutMap(useSettingsStore.getState().appSettings?.keybinds, KEYBIND_ACTIONS);

    for (const def of KEYBIND_DEFINITIONS) {
      const userCombo = keybinds[def.action];
      const effective = userCombo && userCombo.length > 0 ? userCombo : def.defaultCombo;
      if (effective.length > 0) {
        comboMap.set(effective.join('+'), def.action);
      }
    }

    const actions: Record<string, ShortcutAction> = {
      open_image: {
        shouldFire: (s) => !s.editor.selectedImage && s.library.libraryActivePath !== null,
        execute: (e, s) => {
          e.preventDefault();
          const activePath = s.library.libraryActivePath;
          if (activePath === null) return;
          handleImageSelect(activePath);
        },
      },
      copy_adjustments: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          void handleCopyAdjustments();
        },
      },
      paste_adjustments: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          handlePasteAdjustments();
        },
      },
      copy_files: {
        shouldFire: (s) => s.library.multiSelectedPaths.length > 0,
        execute: (e, s) => {
          e.preventDefault();
          s.process.setProcess({ copiedFilePaths: s.library.multiSelectedPaths });
        },
      },
      paste_files: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          handlePasteFiles('copy');
        },
      },
      select_all: {
        shouldFire: () => sortedListRef.current.length > 0,
        execute: (e, s) => {
          e.preventDefault();
          s.library.setLibrary({ multiSelectedPaths: sortedListRef.current.map((f: ImageFile) => f.path) });
          if (!s.editor.selectedImage) {
            const lastImage = sortedListRef.current[sortedListRef.current.length - 1];
            if (lastImage) s.library.setLibrary({ libraryActivePath: lastImage.path });
          }
        },
      },
      delete_selected: {
        shouldFire: (s) => !s.editor.activeMaskContainerId && !s.editor.activeAiPatchContainerId,
        execute: (e) => {
          e.preventDefault();
          handleDeleteSelected();
        },
      },
      preview_prev: {
        shouldFire: (s) =>
          !!s.editor.selectedImage &&
          shouldAllowViewerImageNavigation({
            controlOwnsKey: false,
            isViewerGestureDragging: isViewerGestureDragging(),
          }),
        execute: (e, s) => {
          e.preventDefault();
          const selectedImage = s.editor.selectedImage;
          if (!selectedImage) return;
          const currentIndex = sortedListRef.current.findIndex((img) => img.path === selectedImage.path);
          if (currentIndex === -1) return;
          const nextIndex = currentIndex - 1 < 0 ? sortedListRef.current.length - 1 : currentIndex - 1;
          const nextImage = sortedListRef.current[nextIndex];
          if (nextImage) handleImageSelect(nextImage.path);
        },
      },
      preview_next: {
        shouldFire: (s) =>
          !!s.editor.selectedImage &&
          shouldAllowViewerImageNavigation({
            controlOwnsKey: false,
            isViewerGestureDragging: isViewerGestureDragging(),
          }),
        execute: (e, s) => {
          e.preventDefault();
          const selectedImage = s.editor.selectedImage;
          if (!selectedImage) return;
          const currentIndex = sortedListRef.current.findIndex((img) => img.path === selectedImage.path);
          if (currentIndex === -1) return;
          const nextIndex = currentIndex + 1 >= sortedListRef.current.length ? 0 : currentIndex + 1;
          const nextImage = sortedListRef.current[nextIndex];
          if (nextImage) handleImageSelect(nextImage.path);
        },
      },
      zoom_in_step: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e) => {
          e.preventDefault();
          handleZoomChange({ direction: 'in', kind: 'step' });
        },
      },
      zoom_out_step: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e) => {
          e.preventDefault();
          handleZoomChange({ direction: 'out', kind: 'step' });
        },
      },
      cycle_zoom: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e) => {
          e.preventDefault();
          handleZoomChange({ kind: 'cycle' });
        },
      },
      zoom_in: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e) => {
          e.preventDefault();
          handleZoomChange({ direction: 'in', kind: 'step' });
        },
      },
      zoom_out: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e) => {
          e.preventDefault();
          handleZoomChange({ direction: 'out', kind: 'step' });
        },
      },
      zoom_fit: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e) => {
          e.preventDefault();
          handleZoomChange({ kind: 'fit' });
        },
      },
      zoom_100: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e) => {
          e.preventDefault();
          handleZoomChange({ kind: 'one-to-one' });
        },
      },
      zoom_fill: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e) => {
          e.preventDefault();
          handleZoomChange({ kind: 'fill' });
        },
      },
      zoom_200: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e) => {
          e.preventDefault();
          handleZoomChange({ kind: 'two-to-one' });
        },
      },
      rotate_left: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e) => {
          e.preventDefault();
          handleRotate(-90);
        },
      },
      rotate_right: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e) => {
          e.preventDefault();
          handleRotate(90);
        },
      },
      undo: {
        shouldFire: (s) => !!s.editor.selectedImage && s.editor.historyIndex > 0,
        execute: (e, s) => {
          e.preventDefault();
          s.editor.undo();
        },
      },
      redo: {
        shouldFire: (s) => !!s.editor.selectedImage && s.editor.historyIndex < s.editor.history.length - 1,
        execute: (e, s) => {
          e.preventDefault();
          s.editor.redo();
        },
      },
      toggle_fullscreen: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e) => {
          e.preventDefault();
          handleToggleFullScreen();
        },
      },
      show_original: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e, s) => {
          e.preventDefault();
          s.editor.setEditor({ compareMode: s.editor.compareMode === 'hold-original' ? 'off' : 'hold-original' });
        },
      },
      toggle_adjustments: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e, s) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Adjustments);
        },
      },
      toggle_color: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e, s) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Color);
        },
      },
      toggle_crop_panel: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e, s) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Crop);
        },
      },
      toggle_masks: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e, s) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Masks);
        },
      },
      toggle_ai: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e, s) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Ai);
        },
      },
      toggle_presets: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e, s) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Presets);
        },
      },
      toggle_metadata: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e, s) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Metadata);
        },
      },
      toggle_tether: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e, s) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Tether);
        },
      },
      toggle_analytics: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e, s) => {
          e.preventDefault();
          s.editor.setEditor({ isWaveformVisible: !s.editor.isWaveformVisible });
        },
      },
      toggle_export: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e, s) => {
          e.preventDefault();
          s.ui.setRightPanel(Panel.Export);
        },
      },
      toggle_library_exif: {
        shouldFire: (s) => !s.editor.selectedImage,
        execute: (e, s) => {
          e.preventDefault();
          const { appSettings } = s.settings;
          if (!appSettings) return;

          const current = appSettings.exifOverlay || ExifOverlay.Off;
          const nextState = {
            [ExifOverlay.Off]: ExifOverlay.Hover,
            [ExifOverlay.Hover]: ExifOverlay.Always,
            [ExifOverlay.Always]: ExifOverlay.Off,
          }[current];
          void s.settings.handleSettingsChange({ ...appSettings, exifOverlay: nextState }).catch((err: unknown) => {
            console.error('Failed to persist EXIF overlay setting:', err);
          });
        },
      },
      toggle_crop: {
        shouldFire: (s) => !!s.editor.selectedImage,
        execute: (e, s) => {
          e.preventDefault();
          if (s.ui.activeRightPanel === Panel.Crop) {
            s.editor.setEditor({ isStraightenActive: !s.editor.isStraightenActive });
          } else {
            s.ui.setRightPanel(Panel.Crop);
            s.editor.setEditor({ isStraightenActive: true });
          }
        },
      },
      rate_0: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          handleRate(0);
        },
      },
      rate_1: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          handleRate(1);
        },
      },
      rate_2: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          handleRate(2);
        },
      },
      rate_3: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          handleRate(3);
        },
      },
      rate_4: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          handleRate(4);
        },
      },
      rate_5: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          handleRate(5);
        },
      },
      color_label_none: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          void handleSetColorLabel(null);
        },
      },
      color_label_red: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          void handleSetColorLabel('red');
        },
      },
      color_label_yellow: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          void handleSetColorLabel('yellow');
        },
      },
      color_label_green: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          void handleSetColorLabel('green');
        },
      },
      color_label_blue: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          void handleSetColorLabel('blue');
        },
      },
      color_label_purple: {
        shouldFire: () => true,
        execute: (e) => {
          e.preventDefault();
          void handleSetColorLabel('purple');
        },
      },
      brush_size_up: {
        shouldFire: (s) =>
          !!s.editor.selectedImage && !!s.editor.brushSettings && s.ui.activeRightPanel === Panel.Masks,
        execute: (e, s) => {
          e.preventDefault();
          const { brushSettings } = s.editor;
          if (!brushSettings) return;

          const newSize = Math.min((brushSettings.size || 50) + 10, 200);
          s.editor.setEditor({ brushSettings: { ...brushSettings, size: newSize } });
        },
      },
      brush_size_down: {
        shouldFire: (s) =>
          !!s.editor.selectedImage && !!s.editor.brushSettings && s.ui.activeRightPanel === Panel.Masks,
        execute: (e, s) => {
          e.preventDefault();
          const { brushSettings } = s.editor;
          if (!brushSettings) return;

          const newSize = Math.max((brushSettings.size || 50) - 10, 1);
          s.editor.setEditor({ brushSettings: { ...brushSettings, size: newSize } });
        },
      },
    };

    const builtinShortcuts: Array<BuiltinShortcut> = [
      {
        match: (e: KeyboardEvent) => e.code === 'Escape',
        execute: (e, s) => {
          e.preventDefault();
          if (s.editor.isStraightenActive) s.editor.setEditor({ isStraightenActive: false });
          else if (s.ui.customEscapeHandler) s.ui.customEscapeHandler();
          else if (s.editor.activeAiSubMaskId) s.editor.setEditor({ activeAiSubMaskId: null });
          else if (s.editor.activeAiPatchContainerId) s.editor.setEditor({ activeAiPatchContainerId: null });
          else if (s.editor.activeMaskId) s.editor.setEditor({ activeMaskId: null });
          else if (s.editor.activeMaskContainerId) s.editor.setEditor({ activeMaskContainerId: null });
          else if (s.ui.activeRightPanel === Panel.Crop) s.ui.setRightPanel(Panel.Adjustments);
          else if (s.ui.isFullScreen) handleToggleFullScreen();
          else if (s.editor.selectedImage) handleBackToLibrary();
        },
      },
      {
        match: (e, s) => {
          const isDeleteKey = s.settings.osPlatform === 'macos' ? e.code === 'Backspace' : e.code === 'Delete';
          return isDeleteKey && (!!s.editor.activeMaskContainerId || !!s.editor.activeAiPatchContainerId);
        },
        execute: (e, s) => {
          e.preventDefault();
          if (s.editor.activeMaskContainerId) {
            s.editor.setEditor((state) => ({
              adjustments: {
                ...state.adjustments,
                masks: state.adjustments.masks.filter((c) => c.id !== s.editor.activeMaskContainerId),
              },
              activeMaskContainerId: null,
              activeMaskId: null,
            }));
          } else if (s.editor.activeAiPatchContainerId) {
            s.editor.setEditor((state) => ({
              adjustments: {
                ...state.adjustments,
                aiPatches: state.adjustments.aiPatches.filter((c) => c.id !== s.editor.activeAiPatchContainerId),
              },
              activeAiPatchContainerId: null,
              activeAiSubMaskId: null,
            }));
          }
        },
      },
      {
        match: (e, s) =>
          !s.editor.selectedImage && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code),
        execute: (e, s) => {
          e.preventDefault();
          const isNext = e.code === 'ArrowRight' || e.code === 'ArrowDown';
          const activePath = s.library.libraryActivePath;
          if (!activePath || sortedListRef.current.length === 0) return;
          const currentIndex = sortedListRef.current.findIndex((img) => img.path === activePath);
          if (currentIndex === -1) return;
          let nextIndex = isNext ? currentIndex + 1 : currentIndex - 1;
          if (nextIndex >= sortedListRef.current.length) nextIndex = 0;
          if (nextIndex < 0) nextIndex = sortedListRef.current.length - 1;
          const nextImage = sortedListRef.current[nextIndex];
          if (nextImage) {
            s.library.setLibrary({ libraryActivePath: nextImage.path, multiSelectedPaths: [nextImage.path] });
          }
        },
      },
    ];

    const handleKeyDown = (event: KeyboardEvent) => {
      const state = getStoreState();

      const isCommandPaletteShortcut =
        (state.settings.osPlatform === 'macos' ? event.metaKey : event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.code === 'KeyK';

      if (isCommandPaletteShortcut) {
        event.preventDefault();
        state.ui.setUI({ isCommandPaletteOpen: !state.ui.isCommandPaletteOpen });
        return;
      }

      const isModalOpen =
        state.ui.isCommandPaletteOpen ||
        state.ui.isCreateFolderModalOpen ||
        state.ui.isRenameFolderModalOpen ||
        state.ui.isRenameFileModalOpen ||
        state.ui.isImportModalOpen ||
        state.ui.isCopyPasteSettingsModalOpen ||
        state.ui.confirmModalState.isOpen ||
        state.ui.panoramaModalState.isOpen ||
        state.ui.superResolutionModalState.isOpen ||
        state.ui.focusStackModalState.isOpen ||
        state.ui.cullingModalState.isOpen ||
        state.ui.collageModalState.isOpen ||
        state.ui.denoiseModalState.isOpen ||
        state.ui.negativeModalState.isOpen;

      if (isModalOpen) return;

      if (isEditableKeyboardTarget(event.target)) return;

      for (const builtin of builtinShortcuts) {
        if (builtin.match(event, state)) {
          builtin.execute(event, state);
          return;
        }
      }

      const normalized = normalizeCombo(event, state.settings.osPlatform);
      const action = comboMap.get(normalized.join('+'));

      if (action) {
        const handler = actions[action];
        if (handler && (!handler.shouldFire || handler.shouldFire(state))) {
          handler.execute(event, state);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    handleBackToLibrary,
    handleDeleteSelected,
    handleImageSelect,
    handlePasteFiles,
    handleToggleFullScreen,
    handleZoomChange,
    handleRotate,
    handleCopyAdjustments,
    handlePasteAdjustments,
    handleRate,
    handleSetColorLabel,
  ]);
};

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
}

function isViewerGestureDragging(): boolean {
  return document.querySelector('[data-editor-pointer-surface="image"][data-viewer-gesture-state="dragging"]') !== null;
}
