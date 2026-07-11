import type { ComponentProps } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProcessStore } from '../../store/useProcessStore';
import { EditorRightPanelHost } from '../panel/right/EditorRightPanelHost';
import { RenderIsland } from './RenderIsland';

type EditorRightPanelRootProps = Omit<ComponentProps<typeof EditorRightPanelHost>, 'exportState' | 'setExportState'>;

export function EditorRightPanelRoot(props: EditorRightPanelRootProps) {
  const { exportState, setExportState } = useProcessStore(
    useShallow((state) => ({ exportState: state.exportState, setExportState: state.setExportState })),
  );

  return (
    <RenderIsland name="editor-right-panel">
      <EditorRightPanelHost {...props} exportState={exportState} setExportState={setExportState} />
    </RenderIsland>
  );
}
