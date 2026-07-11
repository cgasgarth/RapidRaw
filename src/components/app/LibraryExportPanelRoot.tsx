import cx from 'clsx';
import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../store/useEditorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useProcessStore } from '../../store/useProcessStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUIStore } from '../../store/useUIStore';
import ExportPanel from '../panel/right/export/ExportPanel';
import { Orientation } from '../ui/AppProperties';
import Resizer from '../ui/Resizer';
import { RenderIsland } from './RenderIsland';

interface LibraryExportPanelRootProps {
  isResizing: boolean;
  onLinkedVariantImported(path: string): Promise<void>;
  onResizeStart: React.MouseEventHandler;
}

export function LibraryExportPanelRoot({
  isResizing,
  onLinkedVariantImported,
  onResizeStart,
}: LibraryExportPanelRootProps) {
  const hasSelectedImage = useEditorStore((state) => state.selectedImage !== null);
  const { multiSelectedPaths, rootPaths } = useLibraryStore(
    useShallow((state) => ({ multiSelectedPaths: state.multiSelectedPaths, rootPaths: state.rootPaths })),
  );
  const { exportState, setExportState } = useProcessStore(
    useShallow((state) => ({ exportState: state.exportState, setExportState: state.setExportState })),
  );
  const { appSettings, handleSettingsChange } = useSettingsStore(
    useShallow((state) => ({ appSettings: state.appSettings, handleSettingsChange: state.handleSettingsChange })),
  );
  const { isFullScreen, isInstantTransition, isVisible, rightPanelWidth, setUI } = useUIStore(
    useShallow((state) => ({
      isFullScreen: state.isFullScreen,
      isInstantTransition: state.isInstantTransition,
      isVisible: state.isLibraryExportPanelVisible,
      rightPanelWidth: state.rightPanelWidth,
      setUI: state.setUI,
    })),
  );
  const onSettingsChange = useCallback(
    (settings: Parameters<typeof handleSettingsChange>[0]) => void handleSettingsChange(settings),
    [handleSettingsChange],
  );
  const onClose = useCallback(() => setUI({ isLibraryExportPanelVisible: false }), [setUI]);

  if (hasSelectedImage || !isVisible) return null;

  return (
    <RenderIsland name="export-panel">
      <Resizer direction={Orientation.Vertical} onMouseDown={onResizeStart} />
      <div
        className={cx(
          'shrink-0 overflow-hidden',
          !isResizing && !isInstantTransition && 'transition-all duration-300 ease-in-out',
        )}
        style={{ width: isFullScreen ? '0px' : `${rightPanelWidth}px` }}
      >
        <ExportPanel
          exportState={exportState}
          multiSelectedPaths={multiSelectedPaths}
          selectedImage={null}
          setExportState={setExportState}
          appSettings={appSettings}
          onSettingsChange={onSettingsChange}
          rootPaths={rootPaths}
          isVisible={isVisible}
          onLinkedVariantImported={onLinkedVariantImported}
          onClose={onClose}
        />
      </div>
    </RenderIsland>
  );
}
