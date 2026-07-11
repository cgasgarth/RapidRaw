import cx from 'clsx';
import { useMemo } from 'react';
import { Slide, ToastContainer } from 'react-toastify';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Theme } from '../ui/AppProperties';
import { RenderIsland } from './RenderIsland';

export function GlobalStatusSurfaces() {
  const theme = useSettingsStore((state) => state.theme);
  const isLightTheme = useMemo(() => [Theme.Light, Theme.Snow, Theme.Arctic].includes(theme), [theme]);

  return (
    <RenderIsland name="global-status">
      <ToastContainer
        position="bottom-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable={false}
        pauseOnHover
        theme={isLightTheme ? 'light' : 'dark'}
        transition={Slide}
        toastClassName={() =>
          cx(
            'relative flex min-h-16 p-4 rounded-lg justify-between overflow-hidden cursor-pointer mb-4',
            'bg-surface! text-text-primary! border! border-border-color! shadow-2xl! max-w-[420px]!',
          )
        }
      />
    </RenderIsland>
  );
}
