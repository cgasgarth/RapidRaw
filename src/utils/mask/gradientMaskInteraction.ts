import {
  type EditDocumentV2,
  editDocumentLayersV2Schema,
  editDocumentSourceArtifactsV2Schema,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import { Mask, type SubMask } from '../../components/panel/right/layers/Masks';
import type {
  LinearGradientMaskParameters,
  RadialGradientMaskParameters,
} from '../../schemas/masks/maskParameterSchemas';
import { selectEditDocumentLayers, selectEditDocumentSourceArtifacts } from '../editDocumentSelectors';
import type { EditTransactionRequest } from '../editTransaction';
import { normalizeLinearGradientParameters, normalizeRadialGradientParameters } from './gradientMaskParameters';

export type GradientMaskTool = typeof Mask.Linear | typeof Mask.Radial;
export type GradientMaskParameters = LinearGradientMaskParameters | RadialGradientMaskParameters;

export interface GradientMaskWorkflowIdentity {
  readonly containerId: string;
  readonly containerKind: 'aiPatches' | 'masks';
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
  readonly subMaskId: string;
  readonly tool: GradientMaskTool;
}

export interface GradientMaskWorkflowState {
  readonly adjustmentRevision: number;
  readonly geometryEpoch: number;
  readonly imageSession: { readonly id: string } | null;
  readonly editDocumentV2: EditDocumentV2;
  readonly selectedImage: { readonly path: string } | null;
  readonly sourceRevision: string;
}

export interface GradientMaskPatch {
  readonly invert?: boolean;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

const sessionId = (state: GradientMaskWorkflowState): string => state.imageSession?.id ?? '';

const isCurrent = (state: GradientMaskWorkflowState, identity: GradientMaskWorkflowIdentity): boolean =>
  state.geometryEpoch === identity.geometryEpoch &&
  sessionId(state) === identity.imageSessionId &&
  state.selectedImage?.path === identity.sourceIdentity &&
  state.sourceRevision === identity.sourceRevision;

const finiteNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const normalizeParameters = (
  tool: GradientMaskTool,
  parameters: Readonly<Record<string, unknown>>,
): GradientMaskParameters =>
  tool === Mask.Linear
    ? normalizeLinearGradientParameters({
        endX: finiteNumber(parameters['endX'], 0),
        endY: finiteNumber(parameters['endY'], 0),
        range: finiteNumber(parameters['range'], 50),
        startX: finiteNumber(parameters['startX'], 0),
        startY: finiteNumber(parameters['startY'], 0),
      })
    : normalizeRadialGradientParameters({
        centerX: finiteNumber(parameters['centerX'], 0),
        centerY: finiteNumber(parameters['centerY'], 0),
        feather: finiteNumber(parameters['feather'], 0.5),
        radiusX: finiteNumber(parameters['radiusX'], 1),
        radiusY: finiteNumber(parameters['radiusY'], 1),
        rotation: finiteNumber(parameters['rotation'], 0),
      });

const patchSubMask = (subMask: SubMask, identity: GradientMaskWorkflowIdentity, patch: GradientMaskPatch): SubMask => {
  if (subMask.id !== identity.subMaskId) return subMask;
  if (subMask.type !== identity.tool) throw new Error('gradient_mask_transaction.tool_mismatch');
  const currentParameters = subMask.parameters ?? {};
  const parameters =
    patch.parameters === undefined
      ? subMask.parameters
      : {
          ...currentParameters,
          ...normalizeParameters(identity.tool, { ...currentParameters, ...patch.parameters }),
        };
  return {
    ...subMask,
    ...(patch.invert === undefined ? {} : { invert: patch.invert }),
    ...(parameters === undefined ? {} : { parameters }),
  };
};

/** Builds one atomic typed edit-document transaction for a gradient gesture. */
export const buildGradientMaskEditTransaction = (
  state: GradientMaskWorkflowState,
  identity: GradientMaskWorkflowIdentity,
  patch: GradientMaskPatch,
  transactionId: string,
): EditTransactionRequest => {
  if (!isCurrent(state, identity)) throw new Error('gradient_mask_transaction.stale_identity');

  const patchContainers = <Container extends { id: string; subMasks: readonly SubMask[] }>(
    containers: readonly Container[],
  ) => {
    let found = false;
    const next = containers.map((container) => {
      if (container.id !== identity.containerId) return container;
      const subMasks = container.subMasks.map((subMask) => {
        if (subMask.id !== identity.subMaskId) return subMask;
        found = true;
        return patchSubMask(subMask, identity, patch);
      });
      return { ...container, subMasks };
    });
    return { found, next };
  };

  const masks =
    identity.containerKind === 'masks' ? patchContainers(selectEditDocumentLayers(state.editDocumentV2).masks) : null;
  const aiPatches =
    identity.containerKind === 'aiPatches'
      ? patchContainers(selectEditDocumentSourceArtifacts(state.editDocumentV2).aiPatches)
      : null;
  if (masks?.found !== true && aiPatches?.found !== true) throw new Error('gradient_mask_transaction.missing_target');

  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      ...(masks === null
        ? []
        : [
            {
              nodeType: 'layers' as const,
              patch: editDocumentLayersV2Schema.parse({ masks: masks.next }),
              type: 'patch-edit-document-node' as const,
            },
          ]),
      ...(aiPatches === null
        ? []
        : [
            {
              nodeType: 'source_artifacts' as const,
              patch: editDocumentSourceArtifactsV2Schema.parse({ aiPatches: aiPatches.next }),
              type: 'patch-edit-document-node' as const,
            },
          ]),
    ],
    persistence: 'commit',
    source: 'layer-command',
    transactionId,
  };
};

export type GradientMaskWorkflowPhase = 'idle' | 'drawing' | 'previewing' | 'refining' | 'applied' | 'cancelled';

export interface GradientMaskWorkflow {
  readonly phase: GradientMaskWorkflowPhase;
  readonly draft: GradientMaskPatch | null;
  begin(): void;
  preview(patch: GradientMaskPatch): void;
  refine(patch: GradientMaskPatch): void;
  apply(): GradientMaskPatch;
  cancel(): void;
}

/** Framework-free draw → preview/refine → apply/cancel lifecycle. */
export const createGradientMaskWorkflow = (baseline: GradientMaskPatch): GradientMaskWorkflow => {
  let phase: GradientMaskWorkflowPhase = 'idle';
  let draft: GradientMaskPatch | null = null;
  return {
    get phase() {
      return phase;
    },
    get draft() {
      return draft;
    },
    begin: () => {
      phase = 'drawing';
      draft = structuredClone(baseline);
    },
    preview: (patch) => {
      if (phase === 'idle' || phase === 'cancelled' || phase === 'applied')
        throw new Error('gradient_mask_workflow.inactive');
      phase = 'previewing';
      draft = { ...draft, ...structuredClone(patch) };
    },
    refine: (patch) => {
      if (draft === null || phase === 'cancelled' || phase === 'applied')
        throw new Error('gradient_mask_workflow.inactive');
      phase = 'refining';
      draft = { ...draft, ...structuredClone(patch) };
    },
    apply: () => {
      if (draft === null || phase === 'cancelled') throw new Error('gradient_mask_workflow.inactive');
      phase = 'applied';
      return structuredClone(draft);
    },
    cancel: () => {
      phase = 'cancelled';
      draft = null;
    },
  };
};
