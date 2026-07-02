import { upsertLayerStackSidecarInSidecar } from '../../../packages/rawengine-schema/src';
import type { NegativeLabSavedPositiveHandoff } from '../../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import { useEditorStore } from '../../store/useEditorStore';
import type { MaskContainer } from '../adjustments';
import { pushEditHistoryEntry } from '../editHistory';
import { buildLayerStackSidecarFromMasks } from '../layers/layerStackCommandBridge';

export interface NegativeConversionEditorHandoff {
  acceptedDustHealLayers?: Array<MaskContainer>;
  acceptedDustHealLayersBySavedPath?: Record<string, Array<MaskContainer>>;
  activePositivePath?: string;
  savedPositiveHandoffs?: Array<NegativeLabSavedPositiveHandoff>;
  openInEditor: boolean;
}

interface HandleNegativeConversionEditorHandoffInput {
  handleImageSelect: (path: string) => Promise<void> | void;
  handoff: NegativeConversionEditorHandoff;
  onRefreshError?: (error: unknown) => void;
  requestThumbnails?: (paths: string[]) => void;
  refreshImageList: () => Promise<void>;
  savedPaths: string[];
}

let pendingAcceptedDustHealLayers: {
  layers: Array<MaskContainer>;
  path: string;
} | null = null;

let pendingSavedPositiveHandoff: NegativeLabSavedPositiveHandoff | null = null;

function appendAcceptedDustHealLayers(layers: Array<MaskContainer> | undefined): void {
  if (layers === undefined || layers.length === 0) return;

  useEditorStore.getState().setEditor((state) => {
    const existingLayerIds = new Set(state.adjustments.masks.map((layer) => layer.id));
    const newLayers = layers.filter((layer) => !existingLayerIds.has(layer.id));
    if (newLayers.length === 0) return {};

    const adjustments = {
      ...state.adjustments,
      masks: [...state.adjustments.masks, ...newLayers],
    };
    const historyState = pushEditHistoryEntry(state.history, state.historyIndex, adjustments);

    return {
      activeMaskContainerId: newLayers[0]?.id ?? state.activeMaskContainerId,
      adjustments,
      history: historyState.history,
      historyIndex: historyState.historyIndex,
    };
  });
}

function persistAcceptedDustHealLayersMetadata(path: string, layers: Array<MaskContainer>): void {
  if (layers.length === 0) return;

  const state = useEditorStore.getState();
  const selectedImage = state.selectedImage;
  if (selectedImage?.path !== path || !selectedImage.isReady) return;

  const selectedMetadata: Record<string, unknown> = {};
  if (
    typeof selectedImage.metadata === 'object' &&
    selectedImage.metadata !== null &&
    !Array.isArray(selectedImage.metadata)
  ) {
    Object.assign(selectedMetadata, selectedImage.metadata);
  }
  const layerStackSidecar = buildLayerStackSidecarFromMasks(layers, {
    graphRevision: `negative_lab_dust_handoff_${path}`,
    imagePath: path,
    operationId: 'negative_lab_dust_handoff',
    sessionId: 'negative_lab_dust_handoff_session',
  });
  const nextMetadata = upsertLayerStackSidecarInSidecar(selectedMetadata, layerStackSidecar);

  state.setEditor({
    selectedImage: {
      ...selectedImage,
      metadata: nextMetadata,
    },
  });
}

export function consumePendingNegativeConversionDustHealLayers(path: string): boolean {
  if (pendingAcceptedDustHealLayers?.path !== path) return false;

  const selectedImage = useEditorStore.getState().selectedImage;
  if (selectedImage?.path !== path || !selectedImage.isReady) return false;

  appendAcceptedDustHealLayers(pendingAcceptedDustHealLayers.layers);
  persistAcceptedDustHealLayersMetadata(path, pendingAcceptedDustHealLayers.layers);
  pendingAcceptedDustHealLayers = null;
  return true;
}

export function consumePendingNegativeConversionSavedPositiveHandoff(
  path: string,
): NegativeLabSavedPositiveHandoff | null {
  if (pendingSavedPositiveHandoff?.path !== path) return null;

  const selectedImage = useEditorStore.getState().selectedImage;
  if (selectedImage?.path !== path || !selectedImage.isReady) return null;

  const handoff = pendingSavedPositiveHandoff;
  pendingSavedPositiveHandoff = null;
  return handoff;
}

export async function handleNegativeConversionEditorHandoff({
  handleImageSelect,
  handoff,
  onRefreshError,
  requestThumbnails,
  refreshImageList,
  savedPaths,
}: HandleNegativeConversionEditorHandoffInput): Promise<void> {
  pendingAcceptedDustHealLayers = null;
  pendingSavedPositiveHandoff = null;
  const firstSavedPath = handoff.activePositivePath ?? savedPaths[0];
  const savedPositiveHandoff =
    handoff.savedPositiveHandoffs?.find((receipt) => receipt.path === firstSavedPath) ?? null;

  try {
    await refreshImageList();
  } catch (error) {
    onRefreshError?.(error);
  }

  if (handoff.openInEditor && firstSavedPath) {
    requestThumbnails?.([firstSavedPath]);
    const acceptedDustHealLayers =
      handoff.acceptedDustHealLayersBySavedPath?.[firstSavedPath] ?? handoff.acceptedDustHealLayers;
    pendingAcceptedDustHealLayers =
      acceptedDustHealLayers !== undefined && acceptedDustHealLayers.length > 0
        ? { layers: acceptedDustHealLayers, path: firstSavedPath }
        : null;
    pendingSavedPositiveHandoff = savedPositiveHandoff;
    try {
      await handleImageSelect(firstSavedPath);
    } catch (error) {
      pendingAcceptedDustHealLayers = null;
      pendingSavedPositiveHandoff = null;
      throw error;
    }
  } else {
    pendingSavedPositiveHandoff = null;
  }
}
