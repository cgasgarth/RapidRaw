import type { ViewerPickerCommitResult } from '../components/panel/editor/viewerPickerInteractionControllers';
import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';
import { buildPointColorEditTransaction } from './pointColorEditTransaction';
import { buildToneEqualizerEditTransaction } from './toneEqualizerEditTransaction';
import { applyToneEqualizerPickerSelection, applyToneEqualizerTargetedDelta } from './toneEqualizerPicker';

export interface ViewerPickerEditTransactionState {
  readonly adjustmentRevision: number;
  readonly adjustments: Adjustments;
  readonly geometryEpoch: number;
  readonly imageSession: { id: string } | null;
  readonly imageSessionId: number;
  readonly selectedImage: { path: string } | null;
  readonly sourceRevision: string;
}

const rejectPicker = (reason: string): never => {
  throw new Error(`viewer_picker_transaction.${reason}`);
};

const currentImageSessionId = (state: ViewerPickerEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

const assertCurrent = (state: ViewerPickerEditTransactionState, command: ViewerPickerCommitResult): void => {
  const { key, result } = command;
  if (key.adjustmentRevision !== state.adjustmentRevision) rejectPicker('stale_adjustment_revision');
  if (key.imageSessionId !== currentImageSessionId(state)) rejectPicker('stale_image_session');
  if (key.sourceIdentity !== state.selectedImage?.path) rejectPicker('stale_source');
  if (key.sourceRevision !== state.sourceRevision) rejectPicker('stale_source_revision');
  if (key.geometryEpoch !== state.geometryEpoch) rejectPicker('stale_geometry');
  if (!Number.isInteger(key.operationGeneration) || key.operationGeneration < 1) rejectPicker('invalid_generation');
  if (
    !Number.isFinite(key.normalizedImagePoint.x) ||
    !Number.isFinite(key.normalizedImagePoint.y) ||
    key.normalizedImagePoint.x < 0 ||
    key.normalizedImagePoint.x > 1 ||
    key.normalizedImagePoint.y < 0 ||
    key.normalizedImagePoint.y > 1
  ) {
    rejectPicker('invalid_sample_point');
  }
  if (result.sourceIdentity !== key.sourceIdentity) rejectPicker('stale_native_source');
  if (result.graphRevision !== key.sourceRevision) rejectPicker('stale_native_revision');
  if (command.kind !== key.toolId) rejectPicker('stale_tool');
};

export const buildPointColorPickerPoint = (
  command: Extract<ViewerPickerCommitResult, { kind: 'point-color' }>,
  createId: () => string,
): Adjustments['pointColor']['points'][number] => ({
  chromaRadius: 0.08,
  chromaShift: 0,
  enabled: true,
  feather: 0.4,
  hueRadiusDegrees: 25,
  hueShiftDegrees: 0,
  id: createId(),
  lightnessRadius: 0.2,
  lightnessShift: 0,
  name: `Point ${String(command.ordinal)}`,
  opacity: 1,
  samples: [
    {
      confidence: command.result.confidence,
      graphRevision: command.result.graphFingerprint,
      id: createId(),
      sampleRadiusPx: command.result.sampleRadiusPx,
      sourceColor: {
        chroma: command.result.chroma,
        hueDegrees: command.result.hueDegrees,
        lightness: command.result.lightness,
      },
      sourceSceneRevision: command.result.sourceFingerprint,
    },
  ],
  saturationShift: 0,
  variance: 1,
});

export const buildViewerPickerEditTransaction = (
  state: ViewerPickerEditTransactionState,
  command: ViewerPickerCommitResult,
  transactionId: string,
  createId: () => string = () => crypto.randomUUID(),
): EditTransactionRequest => {
  assertCurrent(state, command);
  const identity = {
    adjustmentRevision: command.key.adjustmentRevision,
    imageSessionId: command.key.imageSessionId,
    sourceIdentity: command.key.sourceIdentity,
  };

  if (command.kind === 'point-color') {
    if (command.ordinal !== state.adjustments.pointColor.points.length + 1) rejectPicker('stale_point_ordinal');
    const point = buildPointColorPickerPoint(command, createId);
    return {
      ...buildPointColorEditTransaction(
        state,
        identity,
        {
          enabled: true,
          points: [...state.adjustments.pointColor.points, point],
          selectedPointId: point.id,
        },
        transactionId,
      ),
      source: 'picker',
    };
  }

  if (JSON.stringify(command.baseline.toneEqualizer) !== JSON.stringify(state.adjustments.toneEqualizer)) {
    rejectPicker('stale_tone_baseline');
  }
  const nextAdjustments =
    Math.abs(command.deltaEv) < 0.01
      ? applyToneEqualizerPickerSelection(command.baseline, command.result)
      : applyToneEqualizerTargetedDelta(command.baseline, command.result, command.deltaEv);
  return {
    ...buildToneEqualizerEditTransaction(state, identity, nextAdjustments.toneEqualizer, transactionId),
    source: 'picker',
  };
};
