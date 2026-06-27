import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { parseAiConnectorStatusPayload } from '../schemas/tauriEventSchemas';
import { useEditorStore } from '../store/useEditorStore';
import { Invokes } from '../tauri/commands';
import { AI_CONNECTOR_STATUS_UPDATE_EVENT } from '../utils/tauriEventNames';

export const AI_CONNECTOR_STATUS_POLL_INTERVAL_MS = 10_000;

const checkAiConnectorStatus = async (): Promise<void> => {
  await invoke(Invokes.CheckAIConnectorStatus);
};

const logAiConnectorStatusError = (message: string, error: unknown): void => {
  console.error(message, error);
};

export const useAiConnectorStatus = (): void => {
  const { setEditor } = useEditorStore(
    useShallow((state) => ({
      setEditor: state.setEditor,
    })),
  );

  useEffect(() => {
    let isActive = true;

    const unlisten = listen<unknown>(AI_CONNECTOR_STATUS_UPDATE_EVENT, (event) => {
      const payload = parseAiConnectorStatusPayload(event.payload);
      if (isActive) {
        setEditor({ isAIConnectorConnected: payload.connected });
      }
    });

    void checkAiConnectorStatus().catch((error: unknown) => {
      logAiConnectorStatusError('Failed to check AI connector status:', error);
    });

    const interval = setInterval(() => {
      void checkAiConnectorStatus().catch((error: unknown) => {
        logAiConnectorStatusError('Failed to check AI connector status:', error);
      });
    }, AI_CONNECTOR_STATUS_POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      clearInterval(interval);
      void unlisten
        .then((unsubscribe) => {
          unsubscribe();
        })
        .catch((error: unknown) => {
          logAiConnectorStatusError('Failed to remove AI connector status listener:', error);
        });
    };
  }, [setEditor]);
};
