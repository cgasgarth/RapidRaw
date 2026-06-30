#!/usr/bin/env bun

import { strict as assert } from 'node:assert';

import { type ImageFile, Panel, type SelectedImage } from '../../../src/components/ui/AppProperties';
import {
  type CommandPaletteUiState,
  commandPaletteCommands,
  createCommandPaletteAction,
  getCommandPaletteDisabledReasonKey,
  getCommandPaletteSelectedImages,
  getCommandPaletteSelectedPaths,
} from '../../../src/utils/commandPaletteModel';

const requiredCommandIds = [
  'collage',
  'culling',
  'denoise',
  'hdrMerge',
  'lensCorrection',
  'negativeLab',
  'panorama',
  'superResolution',
] as const;

const imageA = makeImage('/photos/a.ARW', { ISO: '100' });
const imageB = makeImage('/photos/b.ARW', { ISO: '200' });
const selectedImage = makeSelectedImage(imageA.path, true);

assertCommandsAreRegistered();
assertSelectedSourceBehavior();
assertUnavailableReasons();
assertWorkflowActionsOpenModalsWithSelectedSources();
assertLensAndTransformActionsOpenCropModals();
assertMergeActionsResetStaleOutputAndPreserveSources();

console.log('command palette behavior ok');

function assertCommandsAreRegistered() {
  for (const commandId of requiredCommandIds) {
    assert.ok(
      commandPaletteCommands.some((command) => command.id === commandId),
      `missing command: ${commandId}`,
    );
  }
}

function assertSelectedSourceBehavior() {
  assert.deepEqual(getCommandPaletteSelectedPaths([], selectedImage), [imageA.path]);
  assert.deepEqual(getCommandPaletteSelectedPaths([imageB.path], selectedImage), [imageB.path]);
  assert.deepEqual(getCommandPaletteSelectedPaths([], null), []);

  const images = Array.from({ length: 12 }, (_, index) => makeImage(`/photos/${index}.ARW`));
  const selectedPaths = images.map((image) => image.path);
  assert.deepEqual(
    getCommandPaletteSelectedImages(images, selectedPaths).map((image) => image.path),
    selectedPaths.slice(0, 9),
  );
}

function assertUnavailableReasons() {
  assert.equal(reasonFor('collage', [], [], selectedImage), 'modals.commandPalette.unavailable.selectSource');
  assert.equal(reasonFor('culling', [], [], selectedImage), 'modals.commandPalette.unavailable.selectSource');
  assert.equal(reasonFor('negativeLab', [], [], selectedImage), 'modals.commandPalette.unavailable.selectSource');
  assert.equal(reasonFor('denoise', [], [], selectedImage), 'modals.commandPalette.unavailable.selectSource');
  assert.equal(reasonFor('denoise', [imageA], [imageA.path], null), 'modals.commandPalette.unavailable.selectImage');
  assert.equal(
    reasonFor('lensCorrection', [imageA], [imageA.path], null),
    'modals.commandPalette.unavailable.selectImage',
  );
  assert.equal(reasonFor('negativeLab', [imageA], [imageA.path], null), null);
}

function assertWorkflowActionsOpenModalsWithSelectedSources() {
  assert.deepEqual(runCommand('collage').state.collageModalState, { isOpen: true, sourceImages: [imageA, imageB] });

  const denoiseState = runCommand('denoise').state.denoiseModalState;
  assert.equal(denoiseState.isOpen, true);
  assert.equal(denoiseState.error, null);
  assert.equal(denoiseState.previewBase64, null);
  assert.equal(denoiseState.progressMessage, null);
  assert.equal(denoiseState.isRaw, true);
  assert.deepEqual(denoiseState.targetPaths, [imageA.path, imageB.path]);

  const cullingState = runCommand('culling').state.cullingModalState;
  assert.equal(cullingState.isOpen, true);
  assert.equal(cullingState.error, null);
  assert.equal(cullingState.progress, null);
  assert.equal(cullingState.suggestions, null);
  assert.deepEqual(cullingState.pathsToCull, [imageA.path, imageB.path]);

  assert.deepEqual(runCommand('negativeLab').state.negativeModalState, {
    isOpen: true,
    targetPaths: [imageA.path, imageB.path],
  });
}

function assertLensAndTransformActionsOpenCropModals() {
  const lensResult = runCommand('lensCorrection');
  assert.deepEqual(lensResult.panels, [Panel.Crop]);
  assert.equal(lensResult.state.isLensCorrectionModalOpen, true);

  const transformResult = runCommand('transformTools');
  assert.deepEqual(transformResult.panels, [Panel.Crop]);
  assert.equal(transformResult.state.isTransformModalOpen, true);
}

function assertMergeActionsResetStaleOutputAndPreserveSources() {
  const panorama = runCommand('panorama').state.panoramaModalState;
  assert.equal(panorama.isOpen, true);
  assert.equal(panorama.error, null);
  assert.equal(panorama.finalImageBase64, null);
  assert.equal(panorama.lastApplyCommand, null);
  assert.equal(panorama.lastDryRunCommand, null);
  assert.equal(panorama.renderedReview, null);
  assert.equal(panorama.runtimePlan, null);
  assert.deepEqual(panorama.stitchingSourcePaths, [imageA.path, imageB.path]);

  const hdr = runCommand('hdrMerge').state.hdrModalState;
  assert.equal(hdr.isOpen, true);
  assert.equal(hdr.finalImageBase64, null);
  assert.equal('lastDryRunCommand' in hdr, false);
  assert.deepEqual(hdr.stitchingSourcePaths, [imageA.path, imageB.path]);
  assert.deepEqual(hdr.sourceMetadata, [
    { exif: imageA.exif, path: imageA.path },
    { exif: imageB.exif, path: imageB.path },
  ]);

  const hdrWithoutSelection = runCommand('hdrMerge', { selectedCommandImages: [], selectedCommandPaths: [] }).state
    .hdrModalState;
  assert.deepEqual(hdrWithoutSelection.stitchingSourcePaths, ['/stale/hdr.ARW']);
  assert.deepEqual(hdrWithoutSelection.sourceMetadata, [{ exif: { ISO: '50' }, path: '/stale/hdr.ARW' }]);

  const focusStack = runCommand('focusStack').state.focusStackModalState;
  assert.equal(focusStack.isOpen, true);
  assert.equal(focusStack.outputReview, null);
  assert.equal('lastDryRunCommand' in focusStack, false);
  assert.deepEqual(focusStack.sourcePaths, [imageA.path, imageB.path]);
  assert.deepEqual(
    focusStack.sourcePreflightMetadata.map((source) => source.imagePath),
    [imageA.path, imageB.path],
  );

  const superResolution = runCommand('superResolution').state.superResolutionModalState;
  assert.equal(superResolution.isOpen, true);
  assert.equal(superResolution.outputReview, null);
  assert.equal('lastDryRunCommand' in superResolution, false);
  assert.deepEqual(superResolution.sourcePaths, [imageA.path, imageB.path]);
  assert.deepEqual(
    superResolution.sourcePreflightMetadata.map((source) => source.imagePath),
    [imageA.path, imageB.path],
  );

  const superResolutionWithoutSelection = runCommand('superResolution', {
    selectedCommandImages: [],
    selectedCommandPaths: [],
  }).state.superResolutionModalState;
  assert.deepEqual(superResolutionWithoutSelection.sourcePaths, ['/stale/sr.ARW']);
  assert.deepEqual(superResolutionWithoutSelection.sourcePreflightMetadata, [
    { path: '/stale/sr.ARW', rating: 5, tags: ['keeper'] },
  ]);
}

function runCommand(
  commandId: (typeof commandPaletteCommands)[number]['id'],
  overrides: {
    selectedCommandImages?: ImageFile[];
    selectedCommandPaths?: string[];
    selectedImage?: SelectedImage | null;
  } = {},
): { panels: Array<Panel | null>; state: CommandPaletteUiState } {
  const state = makeUiState();
  const panels: Array<Panel | null> = [];
  const command = commandPaletteCommands.find((candidate) => candidate.id === commandId);
  assert.ok(command, `missing command fixture: ${commandId}`);

  const action = createCommandPaletteAction(command, {
    imageList: [imageA, imageB],
    onBackToLibrary: () => {
      state.backToLibraryCalled = true;
    },
    selectedCommandImages: overrides.selectedCommandImages ?? [imageA, imageB],
    selectedCommandPaths: overrides.selectedCommandPaths ?? [imageA.path, imageB.path],
    selectedImage: overrides.selectedImage === undefined ? selectedImage : overrides.selectedImage,
    setRightPanel: (panel) => {
      panels.push(panel);
    },
    setUI: (updater) => {
      const patch = typeof updater === 'function' ? updater(state) : updater;
      Object.assign(state, patch);
    },
  });

  assert.ok(action, `missing action for command: ${commandId}`);
  action();
  return { panels, state };
}

function reasonFor(
  commandId: (typeof commandPaletteCommands)[number]['id'],
  selectedCommandImages: ImageFile[],
  selectedCommandPaths: string[],
  currentSelectedImage: SelectedImage | null,
) {
  const command = commandPaletteCommands.find((candidate) => candidate.id === commandId);
  assert.ok(command, `missing command fixture: ${commandId}`);
  return getCommandPaletteDisabledReasonKey(command, selectedCommandImages, selectedCommandPaths, currentSelectedImage);
}

function makeUiState(): CommandPaletteUiState {
  return {
    cullingModalState: {
      error: 'stale culling error',
      isOpen: false,
      pathsToCull: [],
      progress: { current: 1, stage: 'stale', total: 2 },
      suggestions: { duplicateGroups: [], rejectedPaths: [] },
    },
    denoiseModalState: {
      error: 'stale denoise error',
      isOpen: false,
      isProcessing: false,
      isRaw: false,
      previewBase64: 'stale-denoise-preview',
      progressMessage: 'stale denoise progress',
      targetPaths: [],
    },
    focusStackModalState: {
      isOpen: false,
      lastDryRunCommand: { commandType: 'computationalMerge.createFocusStack' },
      outputReview: { status: 'stale' },
      sourcePaths: ['/stale/focus.ARW'],
      sourcePreflightMetadata: [{ path: '/stale/focus.ARW' }],
    },
    hdrModalState: {
      error: 'stale hdr error',
      finalImageBase64: 'stale-hdr-output',
      isOpen: false,
      lastDryRunCommand: { commandType: 'computationalMerge.createHdr' },
      progressMessage: 'stale hdr progress',
      sourceMetadata: [{ exif: { ISO: '50' }, path: '/stale/hdr.ARW' }],
      stitchingSourcePaths: ['/stale/hdr.ARW'],
    },
    negativeModalState: { isOpen: false, targetPaths: [] },
    panoramaModalState: {
      error: 'stale panorama error',
      finalImageBase64: 'stale-panorama-output',
      isOpen: false,
      lastApplyCommand: { commandType: 'computationalMerge.createPanorama' },
      lastDryRunCommand: { commandType: 'computationalMerge.createPanorama' },
      progressMessage: 'stale panorama progress',
      renderedReview: { status: 'stale' },
      runtimePlan: { status: 'stale' },
      stitchingSourcePaths: ['/stale/panorama.ARW'],
    },
    superResolutionModalState: {
      isOpen: false,
      lastDryRunCommand: { commandType: 'computationalMerge.createSuperResolution' },
      outputReview: { status: 'stale' },
      sourcePaths: ['/stale/sr.ARW'],
      sourcePreflightMetadata: [{ path: '/stale/sr.ARW', rating: 5, tags: ['keeper'] }],
    },
  };
}

function makeImage(path: string, exif: Record<string, string> | null = null): ImageFile {
  return {
    exif,
    is_edited: false,
    is_virtual_copy: false,
    modified: 0,
    path,
    rating: 0,
    tags: null,
  };
}

function makeSelectedImage(path: string, isRaw: boolean): SelectedImage {
  return {
    exif: null,
    height: 2000,
    isRaw,
    isReady: true,
    originalUrl: null,
    path,
    thumbnailUrl: '',
    width: 3000,
  };
}
