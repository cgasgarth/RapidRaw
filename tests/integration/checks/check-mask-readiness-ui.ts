#!/usr/bin/env bun

import { z } from 'zod';

import {
  BrushMaskCommandRuntime,
  renderBrushMask,
} from '../../../packages/rawengine-schema/src/brushMaskCommandRuntime.ts';
import { LinearGradientMaskCommandRuntime } from '../../../packages/rawengine-schema/src/linearGradientMaskCommandRuntime.ts';
import {
  ActorKind,
  ApprovalClass,
  layerMaskCommandEnvelopeV1Schema,
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { Mask, SubMaskMode, type SubMask } from '../../../src/components/panel/right/Masks.tsx';
import { createEditorSubMaskForImage } from '../../../src/utils/editorSubMaskFactory.ts';
import {
  INITIAL_MASK_ADJUSTMENTS,
  INITIAL_MASK_CONTAINER,
  type MaskContainer,
} from '../../../src/utils/adjustments.ts';
import { buildLayerExportReadinessSummary } from '../../../src/utils/layerStack.ts';
import { buildLinearGradientMaskCommandFromParameters } from '../../../src/utils/linearGradientMaskCommandBridge.ts';
import {
  createColorRangeMaskParameters,
  evaluateColorRangeMaskWeight,
} from '../../../src/utils/colorRangeMaskParameters.ts';

const IMAGE_SIZE = { height: 12, width: 16 };
const context = {
  expectedGraphRevision: 'graph_rev_mask_readiness_quick_add',
  imagePath: '/photos/session/IMG_4123.CR3',
  imageSize: IMAGE_SIZE,
  sessionId: 'session_mask_readiness_quick_add',
};

const failures: Array<string> = [];

const quickAddActionSchema = z.object({
  disabled: z.boolean(),
  testId: z.enum(['mask-quick-add-brush', 'mask-quick-add-gradient', 'mask-quick-add-range']),
  type: z.enum([Mask.Brush, Mask.Linear, Mask.Color]),
});

type QuickAddAction = z.infer<typeof quickAddActionSchema>;

interface QuickAddState {
  activeContainerId: string;
  layers: Array<MaskContainer>;
  selectedContainerId: string | null;
  selectedSubMaskId: string | null;
}

const createInitialState = (): QuickAddState => {
  const brushSubMask = createQuickAddSubMask(Mask.Brush);
  return {
    activeContainerId: 'mask_container_quick_add',
    layers: [
      {
        ...structuredClone(INITIAL_MASK_CONTAINER),
        adjustments: structuredClone(INITIAL_MASK_ADJUSTMENTS),
        id: 'mask_container_quick_add',
        name: 'Quick-add readiness layer',
        subMasks: [brushSubMask],
      },
    ],
    selectedContainerId: 'mask_container_quick_add',
    selectedSubMaskId: brushSubMask.id,
  };
};

const createQuickAddSubMask = (type: Mask): SubMask =>
  createEditorSubMaskForImage({
    imageDimensions: IMAGE_SIZE,
    mode: SubMaskMode.Additive,
    orientationSteps: 0,
    type,
  });

const getActiveContainer = (state: QuickAddState): MaskContainer => {
  const activeContainer = state.layers.find((layer) => layer.id === state.activeContainerId);
  if (activeContainer === undefined) throw new Error('Active quick-add container was not found.');
  return activeContainer;
};

const buildReadiness = (container: MaskContainer) => ({
  componentCount: container.subMasks.length,
  hasBrush: container.subMasks.some((subMask) => subMask.type === Mask.Brush),
  hasGradient: container.subMasks.some((subMask) => subMask.type === Mask.Linear || subMask.type === Mask.Radial),
  hasRange: container.subMasks.some((subMask) => subMask.type === Mask.Color || subMask.type === Mask.Luminance),
});

const buildQuickAddActions = (container: MaskContainer): Array<QuickAddAction> => {
  const readiness = buildReadiness(container);
  return [
    { disabled: readiness.hasBrush, testId: 'mask-quick-add-brush', type: Mask.Brush },
    { disabled: readiness.hasGradient, testId: 'mask-quick-add-gradient', type: Mask.Linear },
    { disabled: readiness.hasRange, testId: 'mask-quick-add-range', type: Mask.Color },
  ].map((action) => quickAddActionSchema.parse(action));
};

const dispatchQuickAdd = (
  state: QuickAddState,
  action: QuickAddAction,
): { command: ReturnType<typeof buildQuickAddCommand>; state: QuickAddState; subMask: SubMask } => {
  if (action.disabled) {
    throw new Error(`Quick-add action ${action.testId} is disabled.`);
  }

  const subMask = createQuickAddSubMask(action.type);
  const nextLayers = state.layers.map((container) =>
    container.id === state.activeContainerId ? { ...container, subMasks: [...container.subMasks, subMask] } : container,
  );

  return {
    command: buildQuickAddCommand(action.type, subMask),
    state: {
      ...state,
      layers: nextLayers,
      selectedContainerId: state.activeContainerId,
      selectedSubMaskId: subMask.id,
    },
    subMask,
  };
};

const buildQuickAddCommand = (type: Mask, subMask: SubMask) => {
  if (type === Mask.Linear) {
    return buildLinearGradientMaskCommandFromParameters(
      subMask.parameters,
      {
        ...context,
        maskName: subMask.name ?? 'Linear quick-add',
        operationId: `quick_add_${type}_${subMask.id}`,
      },
      { dryRun: true },
    );
  }

  if (type === Mask.Color) {
    const { sourceRangeKey: _sourceRangeKey, ...selection } = createColorRangeMaskParameters('reds', {
      feather: 0.25,
      hueToleranceDegrees: 24,
      maxLuma: 0.95,
      maxSaturation: 1,
      minLuma: 0.05,
      minSaturation: 0.2,
    });
    return layerMaskCommandEnvelopeV1Schema.parse({
      actor: {
        id: 'rapidraw-ui',
        kind: ActorKind.Ui,
        sessionId: context.sessionId,
      },
      approval: {
        approvalClass: ApprovalClass.PreviewOnly,
        reason: 'Preview color range quick-add mask.',
        state: 'not_required',
      },
      commandId: `range_mask_quick_add_${subMask.id}_preview`,
      commandType: 'layerMask.createRangeMask',
      correlationId: `range_mask_corr_quick_add_${subMask.id}`,
      dryRun: true,
      expectedGraphRevision: context.expectedGraphRevision,
      idempotencyKey: `range_mask_idem_quick_add_${subMask.id}_preview`,
      parameters: {
        maskName: subMask.name ?? 'Color quick-add',
        selection: {
          ...selection,
          rangeKind: 'color',
        },
        source: 'working_rgb',
      },
      schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
      target: {
        imagePath: context.imagePath,
        kind: 'image',
      },
    });
  }

  return layerMaskCommandEnvelopeV1Schema.parse({
    actor: {
      id: 'rapidraw-ui',
      kind: ActorKind.Ui,
      sessionId: context.sessionId,
    },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Preview quick-add brush mask.',
      state: 'not_required',
    },
    commandId: `brush_mask_quick_add_${subMask.id}_preview`,
    commandType: 'layerMask.createBrushMask',
    correlationId: `brush_mask_corr_quick_add_${subMask.id}`,
    dryRun: true,
    expectedGraphRevision: context.expectedGraphRevision,
    idempotencyKey: `brush_mask_idem_quick_add_${subMask.id}_preview`,
    parameters: {
      maskName: subMask.name ?? 'Brush quick-add',
      strokes: [
        {
          flow: 1,
          hardness: 1,
          mode: 'paint',
          points: [
            { x: 0.25, y: 0.5 },
            { x: 0.75, y: 0.5 },
          ],
          radiusPx: 3,
          strokeId: `${subMask.id}_readiness_stroke`,
        },
      ],
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: context.imagePath,
      kind: 'image',
    },
  });
};

const countNonZeroAlpha = (alpha: ReadonlyArray<number>): number => alpha.filter((value) => value > 0).length;
const sumAlpha = (alpha: ReadonlyArray<number>): number =>
  Number(alpha.reduce((total, value) => total + value, 0).toFixed(6));

let state = createInitialState();
let activeContainer = getActiveContainer(state);
const initialReadiness = buildReadiness(activeContainer);
if (
  initialReadiness.componentCount !== 1 ||
  !initialReadiness.hasBrush ||
  initialReadiness.hasGradient ||
  initialReadiness.hasRange
) {
  failures.push(`Initial readiness did not reflect a brush-only active mask: ${JSON.stringify(initialReadiness)}`);
}

const initialActions = buildQuickAddActions(activeContainer);
if (
  !initialActions.find((action) => action.type === Mask.Brush)?.disabled ||
  initialActions.find((action) => action.type === Mask.Linear)?.disabled ||
  initialActions.find((action) => action.type === Mask.Color)?.disabled
) {
  failures.push(`Initial quick-add action enablement is wrong: ${JSON.stringify(initialActions)}`);
}

for (const type of [Mask.Linear, Mask.Color] as const) {
  const action = buildQuickAddActions(getActiveContainer(state)).find((candidate) => candidate.type === type);
  if (action === undefined) {
    failures.push(`Missing quick-add action for ${type}.`);
    continue;
  }

  try {
    const result = dispatchQuickAdd(state, action);
    state = result.state;
    activeContainer = getActiveContainer(state);

    if (state.selectedContainerId !== activeContainer.id || state.selectedSubMaskId !== result.subMask.id) {
      failures.push(`${type}: quick-add did not select the inserted sub-mask.`);
    }
    if (activeContainer.subMasks.at(-1)?.id !== result.subMask.id) {
      failures.push(`${type}: quick-add did not append to the active container.`);
    }
    if (result.command.dryRun !== true || result.command.approval.approvalClass !== ApprovalClass.PreviewOnly) {
      failures.push(`${type}: quick-add command must be preview-only before apply.`);
    }

    if (type === Mask.Linear) {
      if (result.command.commandType !== 'layerMask.createGradientMask') {
        failures.push('Linear quick-add did not emit a createGradientMask command.');
      } else {
        const runtime = new LinearGradientMaskCommandRuntime(IMAGE_SIZE);
        const dryRun = layerMaskDryRunResultV1Schema.parse(runtime.dispatch(result.command));
        const apply = layerMaskMutationResultV1Schema.parse(
          runtime.dispatch(
            layerMaskCommandEnvelopeV1Schema.parse({
              ...result.command,
              approval: {
                approvalClass: ApprovalClass.EditApply,
                reason: 'Apply linear gradient quick-add mask.',
                state: 'approved',
              },
              commandId: `${result.command.commandId}_apply`,
              dryRun: false,
              idempotencyKey: `${result.command.idempotencyKey}_apply`,
            }),
          ),
        );

        const artifact = dryRun.maskArtifacts[0];
        if (
          dryRun.mutates ||
          artifact?.dimensions.width !== IMAGE_SIZE.width ||
          artifact.dimensions.height !== IMAGE_SIZE.height
        ) {
          failures.push('Linear quick-add dry-run did not expose a non-mutating mask artifact with image dimensions.');
        }
        if (!apply.mutates || apply.changedMaskIds.length !== 1) {
          failures.push('Linear quick-add apply did not mutate the accepted mask.');
        }
      }
    } else {
      if (result.command.commandType !== 'layerMask.createRangeMask') {
        failures.push('Range quick-add did not emit a createRangeMask command.');
      } else {
        const helperParameters = createColorRangeMaskParameters('reds', {
          feather: 0.25,
          hueToleranceDegrees: 24,
          maxLuma: 0.95,
          maxSaturation: 1,
          minLuma: 0.05,
          minSaturation: 0.2,
        });
        const onTargetWeight = evaluateColorRangeMaskWeight(
          { hueDegrees: 0, luma: 0.5, saturation: 0.8 },
          helperParameters,
        );
        const offTargetWeight = evaluateColorRangeMaskWeight(
          { hueDegrees: 120, luma: 0.5, saturation: 0.8 },
          helperParameters,
        );
        if (onTargetWeight < 0.99 || offTargetWeight !== 0) {
          failures.push(`Range quick-add helper weights are out of bounds: ${onTargetWeight}/${offTargetWeight}.`);
        }
      }
    }
  } catch (error) {
    failures.push(`${type}: quick-add dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

activeContainer = getActiveContainer(state);
const finalReadiness = buildReadiness(activeContainer);
if (
  finalReadiness.componentCount !== 3 ||
  !finalReadiness.hasBrush ||
  !finalReadiness.hasGradient ||
  !finalReadiness.hasRange
) {
  failures.push(`Final readiness did not reflect brush, gradient, and range masks: ${JSON.stringify(finalReadiness)}`);
}

const finalActions = buildQuickAddActions(activeContainer);
if (!finalActions.every((action) => action.disabled)) {
  failures.push(`Final quick-add actions should all be disabled: ${JSON.stringify(finalActions)}`);
}

const exportReadiness = buildLayerExportReadinessSummary(state.layers);
if (
  exportReadiness.totalLayerCount !== 1 ||
  exportReadiness.exportableLayerCount !== 1 ||
  exportReadiness.maskedLayerCount !== 1
) {
  failures.push(`Layer export readiness mismatch after quick-add flow: ${JSON.stringify(exportReadiness)}`);
}

const brushAction = buildQuickAddActions(activeContainer).find((action) => action.type === Mask.Brush);
if (brushAction === undefined || !brushAction.disabled) {
  failures.push('Brush quick-add should remain disabled once the active container already has a brush.');
} else {
  const brushSubMask = activeContainer.subMasks.find((subMask) => subMask.type === Mask.Brush);
  if (brushSubMask === undefined) {
    failures.push('Brush sub-mask missing from final active container.');
  } else {
    const brushCommand = buildQuickAddCommand(Mask.Brush, brushSubMask);
    const render = renderBrushMask({ command: brushCommand, height: IMAGE_SIZE.height, width: IMAGE_SIZE.width });
    const dryRun = layerMaskDryRunResultV1Schema.parse(
      new BrushMaskCommandRuntime().dispatch(brushCommand, { height: IMAGE_SIZE.height, width: IMAGE_SIZE.width }),
    );
    const coveredPixels = countNonZeroAlpha(render.alpha);
    const alphaTotal = sumAlpha(render.alpha);
    if (coveredPixels < 20 || coveredPixels > 80 || alphaTotal < 20 || alphaTotal > 80) {
      failures.push(`Brush quick-add render metric out of expected bounds: ${coveredPixels} px, alpha ${alphaTotal}.`);
    }
    if (dryRun.mutates || dryRun.maskArtifacts[0]?.contentHash !== render.contentHash) {
      failures.push('Brush quick-add dry-run did not match the rendered mask artifact.');
    }
  }
}

if (failures.length > 0) {
  console.error('mask readiness quick-add validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `mask readiness quick-add ok (${finalReadiness.componentCount} components, ${exportReadiness.maskedLayerCount} masked layer)`,
);
