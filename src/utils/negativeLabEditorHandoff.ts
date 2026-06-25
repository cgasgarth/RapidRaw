import { pushEditHistoryEntry } from './editHistory';
import { useEditorStore } from '../store/useEditorStore';

import type { MaskContainer } from './adjustments';

export interface NegativeConversionEditorHandoff {
  acceptedDustHealLayers?: Array<MaskContainer>;
  acceptedDustHealLayersBySavedPath?: Record<string, Array<MaskContainer>>;
  openInEditor: boolean;
}

interface HandleNegativeConversionEditorHandoffInput {
  handleImageSelect: (path: string) => Promise<void> | void;
  handoff: NegativeConversionEditorHandoff;
  onRefreshError?: (error: unknown) => void;
  refreshImageList: () => Promise<void>;
  savedPaths: string[];
}

let pendingAcceptedDustHealLayers: {
  layers: Array<MaskContainer>;
  path: string;
} | null = null;

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

export function consumePendingNegativeConversionDustHealLayers(path: string): boolean {
  if (pendingAcceptedDustHealLayers?.path !== path) return false;

  const selectedImage = useEditorStore.getState().selectedImage;
  if (selectedImage?.path !== path || !selectedImage.isReady) return false;

  appendAcceptedDustHealLayers(pendingAcceptedDustHealLayers.layers);
  pendingAcceptedDustHealLayers = null;
  return true;
}

export async function handleNegativeConversionEditorHandoff({
  handleImageSelect,
  handoff,
  onRefreshError,
  refreshImageList,
  savedPaths,
}: HandleNegativeConversionEditorHandoffInput): Promise<void> {
  const firstSavedPath = savedPaths[0];

  try {
    await refreshImageList();
  } catch (error) {
    onRefreshError?.(error);
  }

  if (handoff.openInEditor && firstSavedPath) {
    const acceptedDustHealLayers =
      handoff.acceptedDustHealLayersBySavedPath?.[firstSavedPath] ?? handoff.acceptedDustHealLayers;
    pendingAcceptedDustHealLayers =
      acceptedDustHealLayers !== undefined && acceptedDustHealLayers.length > 0
        ? { layers: acceptedDustHealLayers, path: firstSavedPath }
        : null;
    await handleImageSelect(firstSavedPath);
  }
}
