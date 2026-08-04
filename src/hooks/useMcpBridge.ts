import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEditorStore } from '../store/useEditorStore';
import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments, type Adjustments } from '../utils/adjustments';

interface McpCommand {
  requestId: string;
  kind: 'select-image' | 'apply-adjustments' | 'reset-adjustments';
  path: string;
  adjustments?: Adjustments;
}

interface McpStateResponse {
  imagePath: string;
  adjustments: Adjustments;
  editRevision: string;
  isSelected: boolean;
}

const wait = (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs));

async function waitForImage(path: string): Promise<void> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const selectedImage = useEditorStore.getState().selectedImage;
    if (selectedImage?.path === path && selectedImage.isReady) return;
    await wait(250);
  }
  throw new Error(`RapidRAW did not finish loading ${path}`);
}

async function syncState(path: string): Promise<McpStateResponse> {
  return invoke<McpStateResponse>('sync_editor_state', {
    path,
    adjustments: useEditorStore.getState().adjustments,
  });
}

export function useMcpBridge(handleImageSelect: (path: string, openInEditor?: boolean) => Promise<void>) {
  const selectedImage = useEditorStore((state) => state.selectedImage);
  const adjustments = useEditorStore((state) => state.adjustments);

  useEffect(() => {
    if (!selectedImage?.path || !selectedImage.isReady) {
      invoke('clear_editor_session').catch((error) =>
        console.warn('Failed to clear the MCP editor session:', error),
      );
      return;
    }

    const sync = () => {
      invoke('sync_editor_state', {
        path: selectedImage.path,
        adjustments,
      }).catch((error) => console.warn('Failed to mirror editor state for MCP:', error));
    };
    sync();
  }, [selectedImage?.path, selectedImage?.isReady, adjustments]);

  useEffect(() => {
    let active = true;
    const unlistenPromise = listen<McpCommand>('mcp-command', async (event) => {
      if (!active) return;
      const command = event.payload;

      try {
        if (command.kind === 'select-image') {
          await handleImageSelect(command.path, true);
          await waitForImage(command.path);
        } else {
          if (useEditorStore.getState().selectedImage?.path !== command.path) {
            await handleImageSelect(command.path, true);
            await waitForImage(command.path);
          }

          const editor = useEditorStore.getState();
          if (command.kind === 'reset-adjustments') {
            const image = editor.selectedImage;
            const aspectRatio = image && image.width > 0 && image.height > 0 ? image.width / image.height : null;
            const resetAdjustments = { ...INITIAL_ADJUSTMENTS, aspectRatio, aiPatches: [] };
            editor.resetHistory(resetAdjustments);
            editor.setEditor({ adjustments: resetAdjustments });
          } else if (command.adjustments) {
            const nextAdjustments = normalizeLoadedAdjustments(command.adjustments);
            editor.setEditor({ adjustments: nextAdjustments });
            editor.pushHistory(nextAdjustments);
          } else {
            throw new Error('MCP adjustment command did not include adjustments');
          }
          await wait(100);
        }

        const response = await syncState(command.path);
        await invoke('ui_response', {
          requestId: command.requestId,
          response: { ...response, isSelected: true },
          error: null,
        });
      } catch (error) {
        await invoke('ui_response', {
          requestId: command.requestId,
          response: {},
          error: error instanceof Error ? error.message : String(error),
        }).catch((responseError) => console.warn('Failed to report MCP UI error:', responseError));
      }
    });

    return () => {
      active = false;
      unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [handleImageSelect]);
}
