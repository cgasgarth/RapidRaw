#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import BottomBar from '../../../../src/components/panel/BottomBar.tsx';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../../src/store/useLibraryStore.ts';
import { useProcessStore } from '../../../../src/store/useProcessStore.ts';
import { useUIStore } from '../../../../src/store/useUIStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';

const failures: string[] = [];
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const i18n = await createTestI18n(locale);

setupStores();
const markup = renderToStaticMarkup(
  createElement(
    I18nextProvider,
    { i18n },
    createElement(BottomBar, {
      imageList: [],
      imageRatings: {},
      isCopied: false,
      isCopyDisabled: false,
      isFilmstripVisible: false,
      isLoading: false,
      isPasted: false,
      isPasteDisabled: false,
      isRatingDisabled: false,
      multiSelectedPaths: ['/library/scene/frame-01.NEF', '/library/scene/frame-02.NEF'],
      onClearSelection: () => undefined,
      onCopy: () => undefined,
      onImageSelect: () => undefined,
      onOpenCopyPasteSettings: () => undefined,
      onPaste: () => undefined,
      onRate: () => undefined,
      onRequestThumbnails: () => undefined,
      rating: 0,
      selectedImage: {
        exif: null,
        height: 3024,
        isRaw: true,
        originalUrl: null,
        path: '/library/scene/frame-01.NEF',
        thumbnailUrl: 'data:image/png;base64,placeholder',
        width: 4032,
      },
      setIsFilmstripVisible: () => undefined,
      showFilmstrip: false,
      showZoomControls: false,
      thumbnailAspectRatio: 'cover',
      totalImages: 12,
    }),
  ),
);

assertIncludes(
  markup,
  'data-testid="editor-bottom-bar-compact-controls"',
  'compact bottom bar should expose compact controls metadata',
);
assertIncludes(
  markup,
  'data-testid="editor-bottom-bar-compact-selection-summary"',
  'compact bottom bar should render a selection summary',
);
assertIncludes(markup, 'data-active-filename="frame-01.NEF"', 'compact bottom bar should surface the active filename');
assertIncludes(markup, 'data-selected-count="2"', 'compact bottom bar should surface the selected count');
assertIncludes(
  markup,
  'frame-01.NEF',
  'compact bottom bar should include the active image context in the visible summary',
);

if (failures.length > 0) {
  console.error('editor compact bottom bar summary failed');
  console.error(failures.slice(0, 10).join('\n'));
  process.exit(1);
}

console.log('editor compact bottom bar summary ok');

function setupStores() {
  useUIStore.setState({
    activeRightPanel: null,
    bottomPanelHeight: 144,
    compactEditorPanelHeightOverride: null,
    isFullScreen: false,
    isInstantTransition: false,
    renderedRightPanel: null,
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
    selectedImage: null,
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
    libraryActivePath: '/library/scene/frame-01.NEF',
    multiSelectedPaths: ['/library/scene/frame-01.NEF', '/library/scene/frame-02.NEF'],
    rootPaths: ['/library'],
  });
  useProcessStore.setState({
    copiedFilePaths: [],
    isCopied: false,
    isPasted: false,
  });
}

async function createTestI18n(resources: Record<string, unknown>) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: { en: { translation: resources } },
  });
  return instance;
}

function assertIncludes(actual: string, expected: string, message: string) {
  if (!actual.includes(expected)) {
    failures.push(`${message}: missing ${expected}`);
  }
}
