#!/usr/bin/env bun

import { mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Panel } from '../../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../../src/store/useLibraryStore.ts';
import { useProcessStore } from '../../../../src/store/useProcessStore.ts';
import { useUIStore } from '../../../../src/store/useUIStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';

const failures: string[] = [];
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const i18n = await createTestI18n(locale);
const repoRoot = process.cwd();

mock.module(`${repoRoot}/src/components/panel/Editor.tsx`, () => ({
  default: () => createElement('div', { 'data-testid': 'stub-editor' }),
}));
mock.module(`${repoRoot}/src/components/panel/BottomBar.tsx`, () => ({
  default: () => createElement('div', { 'data-testid': 'stub-bottom-bar' }),
}));
mock.module(`${repoRoot}/src/components/panel/right/EditorRightPanelHost.tsx`, () => ({
  EditorRightPanelHost: () => createElement('div', { 'data-testid': 'stub-right-panel-host' }),
}));
mock.module(`${repoRoot}/src/components/panel/right/RightPanelSwitcher.tsx`, () => ({
  default: () => createElement('div', { 'data-testid': 'stub-right-panel-switcher' }),
}));
mock.module(`${repoRoot}/src/components/ui/Resizer.tsx`, () => ({
  default: () => createElement('div', { 'data-testid': 'stub-resizer' }),
}));

const { default: EditorToolbar } = await import('../../../../src/components/panel/editor/EditorToolbar.tsx');
const { default: EditorView } = await import('../../../../src/components/views/EditorView.tsx');

setupStores(false);
const toolbarExitMarkup = renderToStaticMarkup(
  createElement(
    I18nextProvider,
    { i18n },
    createElement(EditorToolbar, {
      adjustmentsHistory: [INITIAL_ADJUSTMENTS],
      adjustmentsHistoryIndex: 0,
      canRedo: false,
      canUndo: false,
      goToAdjustmentsHistoryIndex: () => undefined,
      isAndroid: false,
      isFullScreen: false,
      isLoading: false,
      onBackToLibrary: () => undefined,
      onOpenNegativeLab: () => undefined,
      onRedo: () => undefined,
      onToggleDateView: () => undefined,
      onToggleFullScreen: () => undefined,
      onToggleShowOriginal: () => undefined,
      onUndo: () => undefined,
      osPlatform: 'linux',
      selectedImage: createSelectedImage(),
      showDateView: false,
      showOriginal: false,
    }),
  ),
);
assertIncludes(
  toolbarExitMarkup,
  'data-tooltip="Toggle preview mode (F)"',
  'toolbar should expose the preview-mode toggle label when not fullscreen',
);

setupStores(true);
const fullscreenToolbarMarkup = renderToStaticMarkup(
  createElement(
    I18nextProvider,
    { i18n },
    createElement(EditorToolbar, {
      adjustmentsHistory: [INITIAL_ADJUSTMENTS],
      adjustmentsHistoryIndex: 0,
      canRedo: false,
      canUndo: false,
      goToAdjustmentsHistoryIndex: () => undefined,
      isAndroid: false,
      isFullScreen: true,
      isLoading: false,
      onBackToLibrary: () => undefined,
      onOpenNegativeLab: () => undefined,
      onRedo: () => undefined,
      onToggleDateView: () => undefined,
      onToggleFullScreen: () => undefined,
      onToggleShowOriginal: () => undefined,
      onUndo: () => undefined,
      osPlatform: 'linux',
      selectedImage: createSelectedImage(),
      showDateView: false,
      showOriginal: false,
    }),
  ),
);
assertIncludes(
  fullscreenToolbarMarkup,
  'data-tooltip="Exit preview mode (F)"',
  'toolbar should expose a dedicated exit label in fullscreen',
);
assertIncludes(
  fullscreenToolbarMarkup,
  'aria-pressed="true"',
  'fullscreen toolbar toggle should publish pressed state',
);

setupStores(false);
const collapsedMarkup = renderEditorView(false);
assertIncludes(collapsedMarkup, 'data-testid="editor-right-panel-shell"', 'editor right panel shell should render');
assertIncludes(collapsedMarkup, 'data-testid="editor-bottom-bar-shell"', 'editor bottom bar shell should render');
assertIncludes(collapsedMarkup, 'max-height:500px', 'editor filmstrip should be expanded in normal mode');
assertIncludes(collapsedMarkup, 'max-width:1000px', 'editor tools panel should be expanded in normal mode');

setupStores(true);
const fullscreenMarkup = renderEditorView(true);
assertIncludes(fullscreenMarkup, 'aria-hidden="true"', 'editor chrome should be hidden from assistive tech');
assertIncludes(fullscreenMarkup, 'max-height:0px', 'filmstrip should collapse in preview-only mode');
assertIncludes(fullscreenMarkup, 'max-width:0px', 'editor tools should collapse in preview-only mode');

if (failures.length > 0) {
  console.error('editor preview-mode exit UI failed');
  console.error(failures.slice(0, 10).join('\n'));
  process.exit(1);
}

console.log('editor preview-mode exit UI ok');

function renderEditorView(isFullScreen: boolean): string {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(EditorView, {
        compactEditorPanelCollapsedHeight: 96,
        compactEditorPanelHeight: 280,
        createResizeHandler: (() => () => undefined) as never,
        isFullScreen,
        handleBackToLibrary: () => undefined,
        handleClearSelection: () => undefined,
        handleCopyAdjustments: () => undefined,
        handleEditorContextMenu: () => undefined,
        handleImageClick: () => undefined,
        handleImageSelect: () => undefined,
        handlePasteAdjustments: () => undefined,
        handleRate: () => undefined,
        handleRightPanelSelect: () => undefined,
        handleThumbnailContextMenu: () => undefined,
        handleZoomChange: () => undefined,
        isAndroid: false,
        isCompactPortrait: false,
        isResizing: false,
        requestThumbnails: () => undefined,
        refreshImageList: async () => undefined,
        sortedImageList: [],
        thumbnailAspectRatio: 'cover',
        transformWrapperRef: createRef() as never,
      }),
    ),
  );
}

function setupStores(isFullScreen: boolean) {
  useUIStore.setState({
    activeRightPanel: Panel.Adjustments,
    bottomPanelHeight: 144,
    compactEditorPanelHeightOverride: null,
    isFullScreen,
    isInstantTransition: false,
    renderedRightPanel: Panel.Adjustments,
    rightPanelWidth: 320,
    uiVisibility: { filmstrip: true, folderTree: true },
  });
  useEditorStore.setState({
    adjustments: INITIAL_ADJUSTMENTS,
    activeAiPatchContainerId: null,
    activeAiSubMaskId: null,
    activeMaskContainerId: null,
    activeMaskId: null,
    displaySize: { width: 0, height: 0 },
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    originalSize: { width: 0, height: 0 },
    previewSize: { width: 0, height: 0 },
    selectedImage: createSelectedImage(),
    showOriginal: false,
    zoom: 1,
    isExportSoftProofEnabled: false,
    isGamutWarningOverlayVisible: false,
    isSliderDragging: false,
    isStraightenActive: false,
    isWbPickerActive: false,
  });
  useLibraryStore.setState({
    imageRatings: {},
    isViewLoading: false,
    libraryActivePath: '/library/preview-test.nef',
    multiSelectedPaths: [],
    rootPaths: ['/library'],
  });
  useProcessStore.setState({
    copiedFilePaths: [],
    isCopied: false,
    isPasted: false,
  });
}

function createSelectedImage() {
  return {
    exif: null,
    height: 3024,
    isRaw: true,
    isReady: true,
    originalUrl: null,
    path: '/library/preview-test.nef',
    thumbnailUrl: 'data:image/png;base64,',
    width: 4032,
  };
}

function assertIncludes(markup: string, needle: string, message: string): void {
  if (!markup.includes(needle)) failures.push(message);
}

async function createTestI18n(resources: typeof locale) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: resources } },
  });
  return instance;
}
