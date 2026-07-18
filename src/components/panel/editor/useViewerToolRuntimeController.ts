import { resolveEditorOverlayBlocker, resolveEditorOverlayVisibility } from '../../../utils/editorOverlayVisibility';
import { useCompareDividerController } from './useCompareDividerController';
import { useCropStraightenController } from './useCropStraightenController';
import { useViewerAiMaskBoxController } from './useViewerAiMaskBoxController';
import { useViewerBrushController } from './useViewerBrushController';
import { useViewerFocusRetouchController } from './useViewerFocusRetouchController';
import { useViewerInitialMaskDrawController } from './useViewerInitialMaskDrawController';
import { useViewerInteractionController } from './useViewerInteractionController';
import { useViewerMaskShapeController } from './useViewerMaskShapeController';
import { useViewerParametricMaskTargetController } from './useViewerParametricMaskTargetController';
import { useViewerPickerControllers } from './useViewerPickerControllers';
import { useViewerRetouchHandlesController } from './useViewerRetouchHandlesController';
import { useViewerSamplerController } from './useViewerSamplerController';
import { useViewerWhiteBalanceController } from './useViewerWhiteBalanceController';
import type { ViewerActiveTool } from './viewerInputResolver';
import { type ViewerInteractionContext, viewerInteractionToolId } from './viewerInteractionCoordinator';

type ControllerInput<Controller> = Controller extends (input: infer Input) => unknown ? Input : never;

interface ViewerToolSuppressionPolicy {
  readonly isAiEditing: boolean;
  readonly isCropping: boolean;
  readonly isMasking: boolean;
  readonly isRotationActive: boolean;
  readonly isSliderDragging: boolean;
  readonly isStraightenActive: boolean;
  readonly isToolActive: boolean;
  readonly isWhiteBalanceActive: boolean;
  readonly requestedActiveTool: ViewerActiveTool | undefined;
}

interface ViewerToolInteractionPolicy {
  readonly geometryEpoch: number;
  readonly imageSessionId: string;
  readonly isCropping: boolean;
  readonly isMaxZoom: boolean;
  readonly isSliderDragging: boolean;
  readonly isStraightenActive: boolean;
  readonly isTemporaryHand: boolean;
  readonly requestedActiveTool: ViewerActiveTool | undefined;
  readonly sourceIdentity: string;
  readonly sourceRevision: string;
}

export interface ViewerToolControllerSnapshot {
  readonly focusRetouchActive: boolean;
  readonly maskShapeActive: boolean;
  readonly pickerActiveTool: ViewerActiveTool | null;
  readonly retouchActive: boolean;
  readonly whiteBalanceActive: boolean;
}

export const resolveViewerSamplerSuppression = (
  policy: ViewerToolSuppressionPolicy,
  snapshot: Pick<ViewerToolControllerSnapshot, 'maskShapeActive' | 'pickerActiveTool'>,
): boolean =>
  policy.isCropping ||
  policy.isMasking ||
  policy.isAiEditing ||
  policy.isSliderDragging ||
  policy.isStraightenActive ||
  policy.isRotationActive ||
  policy.isWhiteBalanceActive ||
  snapshot.pickerActiveTool !== null ||
  snapshot.maskShapeActive ||
  policy.isToolActive ||
  (policy.requestedActiveTool !== undefined && policy.requestedActiveTool !== 'none');

export const resolveViewerInteractionRuntime = (
  policy: ViewerToolInteractionPolicy,
  snapshot: ViewerToolControllerSnapshot,
): { readonly activeTool: ViewerActiveTool; readonly context: ViewerInteractionContext } => {
  const activeTool: ViewerActiveTool = policy.isCropping
    ? policy.isStraightenActive
      ? 'straighten'
      : 'crop'
    : (snapshot.pickerActiveTool ??
      (snapshot.whiteBalanceActive ? 'white-balance' : null) ??
      (snapshot.focusRetouchActive ? 'focus-retouch' : null) ??
      (snapshot.retouchActive ? 'retouch' : null) ??
      policy.requestedActiveTool ??
      'none');
  return {
    activeTool,
    context: {
      activeTool,
      focusContext: policy.isSliderDragging ? 'editable' : 'viewer',
      geometryEpoch: policy.geometryEpoch,
      imageSessionId: policy.imageSessionId,
      isTemporaryHand: policy.isTemporaryHand,
      pointerCount: 1,
      sourceIdentity: policy.sourceIdentity,
      sourceRevision: policy.sourceRevision,
      toolId: snapshot.retouchActive ? 'retouch' : viewerInteractionToolId(activeTool),
      zoomed: policy.isMaxZoom,
    },
  };
};

export interface ViewerToolRuntimeControllerInput {
  readonly aiMaskBox: ControllerInput<typeof useViewerAiMaskBoxController>;
  readonly brush: ControllerInput<typeof useViewerBrushController>;
  readonly compareDivider: Omit<ControllerInput<typeof useCompareDividerController>, 'context'> & {
    readonly context: Omit<ControllerInput<typeof useCompareDividerController>['context'], 'active'>;
  };
  readonly cropStraighten: ControllerInput<typeof useCropStraightenController>;
  readonly focusRetouch: ControllerInput<typeof useViewerFocusRetouchController>;
  readonly initialMaskDraw: ControllerInput<typeof useViewerInitialMaskDrawController>;
  readonly interaction: ViewerToolInteractionPolicy;
  readonly maskShape: ControllerInput<typeof useViewerMaskShapeController>;
  readonly overlayBlocker: Omit<
    Parameters<typeof resolveEditorOverlayBlocker>[0],
    'hasActiveRemoveSource' | 'hasActiveRetouchSource'
  > & {
    readonly hasActiveRemoveSource: boolean;
    readonly hasActiveRetouchSource: boolean;
  };
  readonly overlayVisibility: Omit<
    Parameters<typeof resolveEditorOverlayVisibility>[0],
    'blocker' | 'isMaskInteractionActive'
  >;
  readonly parametricMaskTarget: ControllerInput<typeof useViewerParametricMaskTargetController>;
  readonly picker: ControllerInput<typeof useViewerPickerControllers>;
  readonly retouchHandles: Omit<ControllerInput<typeof useViewerRetouchHandlesController>, 'visible'> & {
    readonly renderable: boolean;
  };
  readonly sampler: Omit<ControllerInput<typeof useViewerSamplerController>, 'suppressed'>;
  readonly suppression: ViewerToolSuppressionPolicy;
  readonly whiteBalance: ControllerInput<typeof useViewerWhiteBalanceController>;
}

/**
 * Canonical viewer runtime owner. ImageCanvas supplies immutable snapshots and
 * explicit command adapters; this coordinator owns all tool hooks and the one
 * input-router registration table.
 */
export const useViewerToolRuntimeController = (input: ViewerToolRuntimeControllerInput) => {
  const picker = useViewerPickerControllers(input.picker);
  const focusRetouch = useViewerFocusRetouchController(input.focusRetouch);
  const whiteBalance = useViewerWhiteBalanceController(input.whiteBalance);
  const brush = useViewerBrushController(input.brush);
  const aiMaskBox = useViewerAiMaskBoxController(input.aiMaskBox);
  const parametricMaskTarget = useViewerParametricMaskTargetController(input.parametricMaskTarget);
  const initialMaskDraw = useViewerInitialMaskDrawController(input.initialMaskDraw);
  const maskShape = useViewerMaskShapeController(input.maskShape);

  const samplerSuppressed = resolveViewerSamplerSuppression(input.suppression, {
    maskShapeActive: maskShape.active,
    pickerActiveTool: picker.activeTool,
  });
  const sampler = useViewerSamplerController({ ...input.sampler, suppressed: samplerSuppressed });

  const overlayBlocker = resolveEditorOverlayBlocker(input.overlayBlocker);
  const overlayVisibility = resolveEditorOverlayVisibility({
    ...input.overlayVisibility,
    blocker: overlayBlocker,
    isMaskInteractionActive: maskShape.active,
  });
  const retouchHandles = useViewerRetouchHandlesController({
    ...input.retouchHandles,
    visible: overlayVisibility.showRetouchRemoveHandles && input.retouchHandles.renderable,
  });
  const compareDivider = useCompareDividerController({
    ...input.compareDivider,
    context: { ...input.compareDivider.context, active: overlayVisibility.showSplitCompare },
  });
  const cropStraighten = useCropStraightenController(input.cropStraighten);

  const { activeTool, context: interactionContext } = resolveViewerInteractionRuntime(input.interaction, {
    focusRetouchActive: focusRetouch.active,
    maskShapeActive: maskShape.active,
    pickerActiveTool: picker.activeTool,
    retouchActive: retouchHandles.activeMode !== null,
    whiteBalanceActive: whiteBalance.active,
  });
  const interaction = useViewerInteractionController({
    context: interactionContext,
    handlers: {
      lifecycle: [brush.handleInputEvent, aiMaskBox.handleInputEvent, initialMaskDraw.handleInputEvent],
      observers: [sampler.handleInputEvent],
      tools: {
        'compare-divider': compareDivider.handleInputEvent,
        'color-mixer': picker.handleInputEvent,
        crop: cropStraighten.handleInputEvent,
        'focus-retouch': focusRetouch.handleInputEvent,
        'point-color': picker.handleInputEvent,
        retouch: retouchHandles.handleInputEvent,
        straighten: cropStraighten.handleInputEvent,
        'tone-equalizer': picker.handleInputEvent,
        'white-balance': whiteBalance.handleInputEvent,
      },
    },
  });

  return {
    activeTool,
    aiMaskBox,
    brush,
    compareDivider,
    cropStraighten,
    focusRetouch,
    initialMaskDraw,
    interaction,
    maskShape,
    overlayBlocker,
    overlayVisibility,
    parametricMaskTarget,
    picker,
    retouchHandles,
    sampler,
    whiteBalance,
  };
};
