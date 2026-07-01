import { type PointerEvent as ReactPointerEvent, useCallback, useState } from 'react';

import { type PanelScopesLayout, useEditorStore } from '../../store/useEditorStore';
import { useSettingsStore } from '../../store/useSettingsStore';

import type { DisplayMode } from '../../utils/adjustments';
import { clampPanelScopesHeight, PANEL_SCOPES_HEIGHT } from '../../utils/waveformSizing';

export function useWaveformControls() {
  const [isResizingWaveform, setIsResizingWaveform] = useState(false);
  const setEditor = useEditorStore((s) => s.setEditor);

  const persistWaveformSettings = useCallback(
    (updates: Partial<{ panelScopesLayout: PanelScopesLayout; waveformHeight: number }>) => {
      const { appSettings, handleSettingsChange } = useSettingsStore.getState();
      if (appSettings) void handleSettingsChange({ ...appSettings, ...updates });
    },
    [],
  );

  const onToggleWaveform = useCallback(() => {
    const newVal = !useEditorStore.getState().isWaveformVisible;
    setEditor({ isWaveformVisible: newVal });
    const { appSettings, handleSettingsChange } = useSettingsStore.getState();
    if (appSettings) void handleSettingsChange({ ...appSettings, isWaveformVisible: newVal });
  }, [setEditor]);

  const setActiveWaveformChannel = useCallback(
    (mode: DisplayMode) => {
      setEditor({ activeWaveformChannel: mode });
      const { appSettings, handleSettingsChange } = useSettingsStore.getState();
      if (appSettings) void handleSettingsChange({ ...appSettings, activeWaveformChannel: mode });
    },
    [setEditor],
  );

  const setWaveformHeight = useCallback(
    (height: number) => {
      const nextHeight = clampPanelScopesHeight(height);
      setEditor({ waveformHeight: nextHeight });
      persistWaveformSettings({ waveformHeight: nextHeight });
    },
    [persistWaveformSettings, setEditor],
  );

  const resetWaveformHeight = useCallback(() => {
    setWaveformHeight(PANEL_SCOPES_HEIGHT.default);
  }, [setWaveformHeight]);

  const setPanelScopesLayout = useCallback(
    (layout: PanelScopesLayout) => {
      setEditor({ panelScopesLayout: layout });
      persistWaveformSettings({ panelScopesLayout: layout });
    },
    [persistWaveformSettings, setEditor],
  );

  const handleWaveformResize = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const pointerId = e.pointerId;
      const target = e.currentTarget;
      const startY = e.clientY;
      const startHeight = useEditorStore.getState().waveformHeight || PANEL_SCOPES_HEIGHT.default;
      const previousTouchAction = document.documentElement.style.touchAction;
      const previousUserSelect = document.documentElement.style.userSelect;

      setIsResizingWaveform(true);
      target.setPointerCapture(pointerId);
      document.documentElement.style.touchAction = 'none';
      document.documentElement.style.userSelect = 'none';

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();
        const delta = moveEvent.clientY - startY;
        const newHeight = clampPanelScopesHeight(startHeight + delta);
        setEditor({ waveformHeight: newHeight });
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
        setIsResizingWaveform(false);
        document.documentElement.style.touchAction = previousTouchAction;
        document.documentElement.style.userSelect = previousUserSelect;
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerUp);

        const { appSettings, handleSettingsChange } = useSettingsStore.getState();
        if (appSettings) {
          void handleSettingsChange({
            ...appSettings,
            waveformHeight: useEditorStore.getState().waveformHeight,
          });
        }
      };

      document.addEventListener('pointermove', handlePointerMove, { passive: false });
      document.addEventListener('pointerup', handlePointerUp);
      document.addEventListener('pointercancel', handlePointerUp);
    },
    [setEditor],
  );

  return {
    isResizingWaveform,
    onToggleWaveform,
    setActiveWaveformChannel,
    setWaveformHeight,
    resetWaveformHeight,
    setPanelScopesLayout,
    handleWaveformResize,
  };
}
