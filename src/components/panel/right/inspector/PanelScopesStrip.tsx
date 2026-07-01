import { AnimatePresence, motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';

import { useEditorActions } from '../../../../hooks/editor/useEditorActions';
import { useWaveformControls } from '../../../../hooks/editor/useWaveformControls';
import { useEditorStore } from '../../../../store/useEditorStore';
import { useSettingsStore } from '../../../../store/useSettingsStore';
import type { Adjustments } from '../../../../utils/adjustments';
import { Orientation } from '../../../ui/AppProperties';
import Resizer from '../../../ui/Resizer';
import Waveform from '../../editor/Waveform';

interface PanelScopesStripProps {
  testId: string;
}

const DEFAULT_PANEL_SCOPES_HEIGHT = 220;

export default function PanelScopesStrip({ testId }: PanelScopesStripProps) {
  const { setAdjustments } = useEditorActions();
  const { isResizingWaveform, setActiveWaveformChannel, handleWaveformResize } = useWaveformControls();
  const theme = useSettingsStore((state) => state.theme);
  const {
    adjustments,
    activeWaveformChannel,
    histogram,
    isWaveformVisible,
    previewScopeStatus,
    waveform,
    waveformHeight,
  } = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments,
      activeWaveformChannel: state.activeWaveformChannel,
      histogram: state.histogram,
      isWaveformVisible: state.isWaveformVisible,
      previewScopeStatus: state.previewScopeStatus,
      waveform: state.waveform,
      waveformHeight: state.waveformHeight,
    })),
  );

  return (
    <AnimatePresence initial={false}>
      {isWaveformVisible ? (
        <motion.div
          animate={{ height: waveformHeight || DEFAULT_PANEL_SCOPES_HEIGHT, opacity: 1 }}
          className="relative flex shrink-0 flex-col overflow-hidden border-b border-surface"
          data-testid={testId}
          data-state="open"
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          transition={{ duration: isResizingWaveform ? 0 : 0.2, ease: 'easeOut' }}
        >
          <div className="min-h-0 h-full w-full grow px-3 pb-1.5 pt-2">
            <Waveform
              displayMode={activeWaveformChannel}
              histogram={histogram}
              onToggleClipping={() => {
                setAdjustments((prev: Adjustments) => ({
                  ...prev,
                  showClipping: !prev.showClipping,
                }));
              }}
              previewScopeStatus={previewScopeStatus}
              setDisplayMode={setActiveWaveformChannel}
              showClipping={adjustments.showClipping || false}
              theme={theme}
              waveformData={waveform || null}
            />
          </div>
          <Resizer direction={Orientation.Horizontal} onMouseDown={handleWaveformResize} />
        </motion.div>
      ) : (
        <div data-testid={testId} data-state="closed" hidden />
      )}
    </AnimatePresence>
  );
}
