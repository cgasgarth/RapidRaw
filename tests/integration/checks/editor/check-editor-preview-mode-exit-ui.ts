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
  default: () =>
    createElement(
      'div',
      { 'data-testid': 'stub-bottom-bar' },
      createElement(
        'button',
        { 'data-testid': 'stub-filmstrip-thumbnail', tabIndex: 0, type: 'button' },
        'Hidden thumbnail',
      ),
    ),
}));
mock.module(`${repoRoot}/src/components/panel/right/EditorRightPanelHost.tsx`, () => ({
  EditorRightPanelHost: () => createElement('div', { 'data-testid': 'stub-right-panel-host' }),
}));
mock.module(`${repoRoot}/src/components/panel/right/RightPanelSwitcher.tsx`, () => ({
  default: () =>
    createElement(
      'div',
      { 'data-testid': 'stub-right-panel-switcher' },
      createElement(
        'button',
        { 'data-testid': 'stub-right-panel-button', tabIndex: 0, type: 'button' },
        'Hidden panel',
      ),
    ),
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
      onToggleFullScreen: () => undefined,
      onToggleShowOriginal: () => undefined,
      onUndo: () => undefined,
      osPlatform: 'linux',
      selectedImage: createSelectedImage(),
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
      onToggleFullScreen: () => undefined,
      onToggleShowOriginal: () => undefined,
      onUndo: () => undefined,
      osPlatform: 'linux',
      selectedImage: createSelectedImage(),
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
assertIncludes(
  collapsedMarkup,
  'data-editor-shell="desktop"',
  'desktop editor should identify its contiguous shell variant',
);
assertIncludes(
  collapsedMarkup,
  'data-editor-region="viewer"',
  'desktop editor should expose a stable viewer region hook',
);
assertIncludes(
  collapsedMarkup,
  'data-editor-region="tool-rail"',
  'desktop editor should expose a stable tool rail region hook',
);
assertIncludes(
  collapsedMarkup,
  'data-editor-region="inspector"',
  'desktop editor should expose a stable inspector region hook',
);
assertIncludes(
  collapsedMarkup,
  'data-editor-region="filmstrip"',
  'desktop editor should expose a stable filmstrip region hook',
);
assertIncludes(
  collapsedMarkup,
  'editor-desktop-workspace grid grid-cols-[minmax(0,1fr)_auto]',
  'desktop editor should use a contiguous residual-viewer grid',
);
assertIncludes(collapsedMarkup, 'max-height:500px', 'editor filmstrip should be expanded in normal mode');
assertShellOpeningTagNotIncludes(
  collapsedMarkup,
  'editor-right-panel-shell',
  'width:0px',
  'editor tools panel should be expanded in normal mode',
);
assertNotIncludes(collapsedMarkup, 'inert=""', 'normal editor chrome should remain focusable');
assertNotIncludes(collapsedMarkup, 'pointer-events-none', 'normal editor chrome should remain pointer-interactive');

setupStores(false);
const compactMarkup = renderEditorView(false, true);
assertIncludes(
  compactMarkup,
  'data-testid="editor-compact-tools-header"',
  'compact editor shell should render a tools header',
);
assertIncludes(
  compactMarkup,
  'data-testid="editor-compact-tools-active-panel"',
  'compact tools header should expose the active panel label',
);
assertIncludes(
  compactMarkup,
  'data-testid="editor-compact-tools-state"',
  'compact tools header should expose collapse state',
);
assertIncludes(
  compactMarkup,
  'data-testid="editor-compact-tools-toggle"',
  'compact tools header should expose an expand/collapse control',
);
assertIncludes(
  compactMarkup,
  'data-testid="editor-compact-tools-grip"',
  'compact tools header should expose a resize affordance',
);
assertIncludes(
  compactMarkup,
  'data-compact-panel-state="expanded"',
  'compact editor shell should report the open panel state',
);
assertIncludes(
  compactMarkup,
  'data-compact-editor-panel-height="280"',
  'compact editor shell should report the panel height',
);
assertIncludes(
  compactMarkup,
  'data-compact-preview-min-height="240"',
  'compact preview region should report its minimum height',
);
assertIncludes(compactMarkup, 'data-testid="editor-compact-filmstrip-shell"', 'compact filmstrip shell should render');

setupStores(true);
const fullscreenMarkup = renderEditorView(true);
assertIncludes(fullscreenMarkup, 'aria-hidden="true"', 'editor chrome should be hidden from assistive tech');
assertIncludes(fullscreenMarkup, 'max-height:0px', 'filmstrip should collapse in preview-only mode');
assertShellOpeningTagIncludes(
  fullscreenMarkup,
  'editor-right-panel-shell',
  'width:0px',
  'editor tools should collapse in preview-only mode',
);
assertIncludes(fullscreenMarkup, 'inert=""', 'fullscreen editor chrome should be removed from sequential focus');
assertIncludes(fullscreenMarkup, 'pointer-events-none', 'fullscreen editor chrome should suppress pointer interaction');
assertSuppressedShellContains(
  fullscreenMarkup,
  'editor-bottom-bar-shell',
  'stub-filmstrip-thumbnail',
  'fullscreen filmstrip controls should stay inside an inert hidden shell',
);
assertSuppressedShellContains(
  fullscreenMarkup,
  'editor-right-panel-shell',
  'stub-right-panel-button',
  'fullscreen right-panel controls should stay inside an inert hidden shell',
);

if (failures.length > 0) {
  console.error('editor preview-mode exit UI failed');
  console.error(failures.slice(0, 10).join('\n'));
  process.exit(1);
}

console.log('editor preview-mode exit UI ok');

function renderEditorView(isFullScreen: boolean, isCompactPortrait = false): string {
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
        isCompactPortrait,
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

function assertNotIncludes(markup: string, needle: string, message: string): void {
  if (markup.includes(needle)) failures.push(message);
}

function assertShellOpeningTagIncludes(markup: string, shellTestId: string, needle: string, message: string): void {
  const shellOpeningTag = getShellOpeningTag(markup, shellTestId);
  if (!shellOpeningTag) {
    failures.push(`${message}: missing shell ${shellTestId}`);
    return;
  }
  if (!shellOpeningTag.includes(needle)) failures.push(message);
}

function assertShellOpeningTagNotIncludes(markup: string, shellTestId: string, needle: string, message: string): void {
  const shellOpeningTag = getShellOpeningTag(markup, shellTestId);
  if (!shellOpeningTag) {
    failures.push(`${message}: missing shell ${shellTestId}`);
    return;
  }
  if (shellOpeningTag.includes(needle)) failures.push(message);
}

function assertSuppressedShellContains(
  markup: string,
  shellTestId: string,
  descendantTestId: string,
  message: string,
): void {
  const shellIndex = markup.indexOf(`data-testid="${shellTestId}"`);
  if (shellIndex === -1) {
    failures.push(`${message}: missing shell ${shellTestId}`);
    return;
  }

  const shellOpeningTag = getShellOpeningTag(markup, shellTestId);
  const descendantIndex = markup.indexOf(`data-testid="${descendantTestId}"`, shellIndex);
  if (!shellOpeningTag || descendantIndex === -1) {
    failures.push(`${message}: missing rendered descendant ${descendantTestId}`);
    return;
  }

  if (!shellOpeningTag.includes('aria-hidden="true"') || !shellOpeningTag.includes('inert=""')) {
    failures.push(`${message}: shell is not hidden and inert`);
  }
  if (!shellOpeningTag.includes('pointer-events-none')) {
    failures.push(`${message}: shell does not suppress pointer interaction`);
  }
}

function getShellOpeningTag(markup: string, shellTestId: string): string | null {
  const shellIndex = markup.indexOf(`data-testid="${shellTestId}"`);
  if (shellIndex === -1) return null;

  const shellOpeningTagStart = markup.lastIndexOf('<', shellIndex);
  const shellOpeningTagEnd = markup.indexOf('>', shellIndex);
  if (shellOpeningTagStart === -1 || shellOpeningTagEnd === -1) return null;

  return markup.slice(shellOpeningTagStart, shellOpeningTagEnd);
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
