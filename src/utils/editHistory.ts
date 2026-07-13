import type { Adjustments } from './adjustments';

export interface EditHistoryCheckpoint {
  createdAt: string;
  historyIndex: number;
  id: string;
  label: string;
}

export interface EditHistoryState<Entry = Adjustments> {
  adjustments: Entry;
  history: Array<Entry>;
  historyIndex: number;
}

export interface EditHistoryItem<Entry = Adjustments> {
  adjustment: Entry;
  checkpoint: EditHistoryCheckpoint | null;
  historyIndex: number;
  isCheckpoint: boolean;
  label: string;
}

export function pushEditHistoryEntry<Entry>(
  history: Array<Entry>,
  historyIndex: number,
  newAdjustments: Entry,
  maxEntries = 50,
): Pick<EditHistoryState<Entry>, 'history' | 'historyIndex'> {
  const nextHistory = history.slice(0, historyIndex + 1);
  nextHistory.push(newAdjustments);
  if (nextHistory.length > maxEntries) nextHistory.shift();
  return { history: nextHistory, historyIndex: nextHistory.length - 1 };
}

export function pushEditHistoryEntryWithCheckpoints<Entry>(
  history: Array<Entry>,
  historyIndex: number,
  newAdjustments: Entry,
  checkpoints: Array<EditHistoryCheckpoint>,
  maxEntries = 50,
): Pick<EditHistoryState<Entry>, 'history' | 'historyIndex'> & { checkpoints: Array<EditHistoryCheckpoint> } {
  const nextHistory = pushEditHistoryEntry(history, historyIndex, newAdjustments, maxEntries);
  const retainedHistoryLengthBeforePush = Math.min(history.length, historyIndex + 1);
  const shiftedEntryCount = Math.max(0, retainedHistoryLengthBeforePush + 1 - nextHistory.history.length);
  const nextCheckpoints = checkpoints
    .filter((checkpoint) => checkpoint.historyIndex <= historyIndex)
    .map((checkpoint) => ({ ...checkpoint, historyIndex: checkpoint.historyIndex - shiftedEntryCount }))
    .filter((checkpoint) => checkpoint.historyIndex >= 0 && checkpoint.historyIndex < nextHistory.history.length);

  return { ...nextHistory, checkpoints: nextCheckpoints };
}

export function undoEditHistory<Entry>(state: EditHistoryState<Entry>): EditHistoryState<Entry> {
  if (state.historyIndex <= 0) return state;
  const historyIndex = state.historyIndex - 1;
  const adjustments = state.history[historyIndex];
  return adjustments ? { ...state, adjustments, historyIndex } : state;
}

export function redoEditHistory<Entry>(state: EditHistoryState<Entry>): EditHistoryState<Entry> {
  if (state.historyIndex >= state.history.length - 1) return state;
  const historyIndex = state.historyIndex + 1;
  const adjustments = state.history[historyIndex];
  return adjustments ? { ...state, adjustments, historyIndex } : state;
}

export function goToEditHistoryIndex<Entry>(
  state: EditHistoryState<Entry>,
  historyIndex: number,
): EditHistoryState<Entry> {
  if (historyIndex < 0 || historyIndex >= state.history.length) return state;
  const adjustments = state.history[historyIndex];
  return adjustments ? { ...state, adjustments, historyIndex } : state;
}

const ADJUSTMENT_LABELS: Record<string, string> = {
  aiPatches: 'AI Patches',
  aspectRatio: 'Aspect Ratio',
  blackWhiteMixer: 'Black & White Mixer',
  colorBalanceRgb: 'Color Balance',
  colorNoiseReduction: 'Color Noise Reduction',
  denoiseContrastProtection: 'Denoise Contrast Protection',
  denoiseDetail: 'Denoise Detail',
  denoiseNaturalGrain: 'Denoise Natural Grain',
  denoiseShadowBias: 'Denoise Shadow Bias',
  chromaticAberrationBlueYellow: 'Chromatic Aberration Blue/Yellow',
  chromaticAberrationRedCyan: 'Chromatic Aberration Red/Cyan',
  centré: 'Centré',
  channelMixer: 'Channel Mixer',
  colorCalibration: 'Color Calibration',
  colorGrading: 'Color Grading',
  dehaze: 'Dehaze',
  exposure: 'Exposure',
  filmLookId: 'Film Look',
  filmLookStrength: 'Film Look Strength',
  flipHorizontal: 'Flip Horizontal',
  flipVertical: 'Flip Vertical',
  grainAmount: 'Grain Amount',
  grainRoughness: 'Grain Roughness',
  grainSize: 'Grain Size',
  halationAmount: 'Halation Amount',
  lensCorrectionMode: 'Lens Correction',
  lensDistortionAmount: 'Lens Distortion',
  lensDistortionEnabled: 'Enable Lens Distortion',
  lensMaker: 'Lens Maker',
  lensModel: 'Lens Model',
  lensTcaAmount: 'Lens TCA',
  lensTcaEnabled: 'Enable Lens TCA',
  lensVignetteAmount: 'Lens Vignette',
  lensVignetteEnabled: 'Enable Lens Vignette',
  localContrastHaloGuard: 'Local Contrast Halo Guard',
  localContrastMidtoneMask: 'Local Contrast Midtone Mask',
  localContrastRadiusPx: 'Local Contrast Radius',
  lumaNoiseReduction: 'Luma Noise Reduction',
  lutData: 'LUT Data',
  lutIntensity: 'LUT Intensity',
  lutName: 'LUT Name',
  lutPath: 'LUT',
  lutSize: 'LUT Size',
  masks: 'Masks',
  orientationSteps: 'Rotation',
  rawProcessingModeOverride: 'RAW Processing Mode',
  sectionVisibility: 'Section Visibility',
  selectiveColorRangeControls: 'Selective Color Range',
  showClipping: 'Show Clipping',
  skinToneUniformity: 'Skin Tone Uniformity',
  toneMapper: 'Tone Mapper',
  transformAspect: 'Transform Aspect',
  transformDistortion: 'Transform Distortion',
  transformHorizontal: 'Transform Horizontal',
  transformRotate: 'Transform Rotate',
  transformScale: 'Transform Scale',
  transformVertical: 'Transform Vertical',
  transformXOffset: 'Transform X Offset',
  transformYOffset: 'Transform Y Offset',
  vignetteAmount: 'Vignette Amount',
  vignetteFeather: 'Vignette Feather',
  vignetteMidpoint: 'Vignette Midpoint',
  vignetteRoundness: 'Vignette Roundness',
};

const formatAdjustmentKey = (key: string): string =>
  ADJUSTMENT_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./u, (first) => first.toUpperCase());

const hasChanged = (prev: Adjustments, curr: Adjustments, key: string): boolean => prev[key] !== curr[key];

const pushMaskDiffLabels = (prev: Adjustments, curr: Adjustments, changed: Array<string>): void => {
  const prevMasks = prev.masks;
  const currMasks = curr.masks;

  if (currMasks.length > prevMasks.length) {
    changed.push('Added Mask');
    return;
  }
  if (currMasks.length < prevMasks.length) {
    changed.push('Deleted Mask');
    return;
  }

  for (const currMask of currMasks) {
    const prevMask = prevMasks.find((mask) => mask.id === currMask.id);
    if (!prevMask) {
      changed.push('Mask');
      continue;
    }
    if (prevMask.opacity !== currMask.opacity) changed.push('Mask Opacity');
    if (prevMask.invert !== currMask.invert) changed.push('Mask Invert');
    if (prevMask.visible !== currMask.visible) changed.push('Mask Visibility');
    if (prevMask.subMasks !== currMask.subMasks) changed.push('Mask Area / Brush');

    if (prevMask.adjustments !== currMask.adjustments) {
      for (const key of Object.keys(currMask.adjustments)) {
        if (prevMask.adjustments[key] !== currMask.adjustments[key]) changed.push(`Mask ${formatAdjustmentKey(key)}`);
      }
    }
  }
};

const pushAiPatchDiffLabels = (prev: Adjustments, curr: Adjustments, changed: Array<string>): void => {
  const prevPatches = prev.aiPatches;
  const currPatches = curr.aiPatches;

  if (currPatches.length > prevPatches.length) {
    changed.push('Added AI Patch');
    return;
  }
  if (currPatches.length < prevPatches.length) {
    changed.push('Deleted AI Patch');
    return;
  }

  for (const currPatch of currPatches) {
    const prevPatch = prevPatches.find((patch) => patch.id === currPatch.id);
    if (!prevPatch) {
      changed.push('AI Patch');
      continue;
    }
    if (prevPatch.visible !== currPatch.visible) changed.push('AI Patch Visibility');
    if (prevPatch.subMasks !== currPatch.subMasks) changed.push('AI Patch Area');
    if (prevPatch.patchData !== currPatch.patchData || prevPatch.prompt !== currPatch.prompt) {
      changed.push('AI Generation');
    }
  }
};

export function formatEditHistoryDiffLabel(prev: Adjustments, curr: Adjustments): string {
  const changed: Array<string> = [];

  for (const key of Object.keys(curr)) {
    if (!hasChanged(prev, curr, key)) continue;

    if (key === 'masks') {
      pushMaskDiffLabels(prev, curr, changed);
    } else if (key === 'aiPatches') {
      pushAiPatchDiffLabels(prev, curr, changed);
    } else {
      changed.push(formatAdjustmentKey(key));
    }
  }

  const uniqueChanged = Array.from(new Set(changed));
  if (uniqueChanged.length === 0) return 'Adjustment';
  if (uniqueChanged.length > 2) return `${uniqueChanged.slice(0, 2).join(', ')}...`;
  return uniqueChanged.join(', ');
}

export function buildEditHistoryItems(
  history: Array<Adjustments>,
  checkpoints: Array<EditHistoryCheckpoint>,
): Array<EditHistoryItem<Adjustments>> {
  const checkpointsByIndex = new Map(checkpoints.map((checkpoint) => [checkpoint.historyIndex, checkpoint]));

  return history.map((adjustment, historyIndex) => {
    const checkpoint = checkpointsByIndex.get(historyIndex) ?? null;
    const label =
      checkpoint?.label.trim() ||
      (historyIndex === 0
        ? 'Initial State'
        : formatEditHistoryDiffLabel(history[historyIndex - 1] ?? adjustment, adjustment));

    return {
      adjustment,
      checkpoint,
      historyIndex,
      isCheckpoint: checkpoint !== null,
      label,
    };
  });
}

export function createEditHistoryCheckpoint(
  checkpoints: Array<EditHistoryCheckpoint>,
  historyIndex: number,
  fallbackLabel: string,
  id: string,
  createdAt: string,
): Array<EditHistoryCheckpoint> {
  const label = fallbackLabel.trim() || `Checkpoint ${historyIndex + 1}`;
  const nextCheckpoint: EditHistoryCheckpoint = { createdAt, historyIndex, id, label };
  const existingIndex = checkpoints.findIndex((checkpoint) => checkpoint.historyIndex === historyIndex);
  if (existingIndex === -1) return [...checkpoints, nextCheckpoint].sort(compareCheckpoints);

  return checkpoints
    .map((checkpoint, index) =>
      index === existingIndex
        ? {
            ...checkpoint,
            label,
          }
        : checkpoint,
    )
    .sort(compareCheckpoints);
}

export function renameEditHistoryCheckpoint(
  checkpoints: Array<EditHistoryCheckpoint>,
  checkpointId: string,
  label: string,
): Array<EditHistoryCheckpoint> {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) return checkpoints;
  return checkpoints.map((checkpoint) =>
    checkpoint.id === checkpointId ? { ...checkpoint, label: trimmedLabel } : checkpoint,
  );
}

function compareCheckpoints(a: EditHistoryCheckpoint, b: EditHistoryCheckpoint): number {
  return a.historyIndex - b.historyIndex || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
