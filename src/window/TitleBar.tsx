import type { UnlistenFn } from '@tauri-apps/api/event';
import { platform } from '@tauri-apps/plugin-os';
import { Minus, Square, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getOptionalCurrentWindow } from './currentWindow';

const RestoreDownIcon = ({ size = 14, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect x="3" y="6" width="8" height="8" rx="1.5" />
    <path d="M6 6V4.5A1.5 1.5 0 0 1 7.5 3h5A1.5 1.5 0 0 1 14 4.5v5A1.5 1.5 0 0 1 12.5 11H11" />
  </svg>
);

export default function TitleBar() {
  const { t } = useTranslation();
  const [osPlatform, setOsPlatform] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);

  const appWindow = useMemo(() => getOptionalCurrentWindow(), []);

  useEffect(() => {
    if (!appWindow) {
      return;
    }

    const getPlatform = () => {
      try {
        const p = platform();
        setOsPlatform(p);
      } catch (error) {
        console.error('Failed to get platform:', error);
        setOsPlatform('windows');
      }
    };
    getPlatform();
  }, [appWindow]);

  useEffect(() => {
    if (!appWindow) {
      return undefined;
    }
    const activeWindow = appWindow;

    const updateMaximizedState = async () => {
      try {
        const max = await activeWindow.isMaximized();
        setIsMaximized(max);
      } catch (error) {
        console.error('Failed to check maximized state:', error);
      }
    };

    void updateMaximizedState();

    let unlisten: (() => void) | undefined;
    let didCleanup = false;
    void activeWindow
      .onResized(() => {
        void updateMaximizedState();
      })
      .then((nextUnlisten: UnlistenFn) => {
        if (didCleanup) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((error: unknown) => {
        console.error('Failed to subscribe to window resize:', error);
      });

    return () => {
      didCleanup = true;
      unlisten?.();
    };
  }, [appWindow]);

  const handleMinimize = useCallback(() => {
    void appWindow?.minimize();
  }, [appWindow]);

  const handleClose = useCallback(() => {
    void appWindow?.close();
  }, [appWindow]);

  const handleMaximize = useCallback(() => {
    void (async () => {
      try {
        if (!appWindow) {
          return;
        }

        if (osPlatform === 'macos') {
          const isFullscreen = await appWindow.isFullscreen();
          await appWindow.setFullscreen(!isFullscreen);
        } else {
          await appWindow.toggleMaximize();
        }
      } catch (error) {
        console.error('Failed to toggle maximize:', error);
      }
    })();
  }, [osPlatform, appWindow]);

  const isMac = osPlatform === 'macos';
  const isLinux = osPlatform === 'linux';
  const isWindows = osPlatform === 'windows';
  const isMobile = osPlatform === 'android';
  if (!appWindow) {
    return (
      <div className="relative pt-2 px-2 w-full z-50 bg-transparent">
        <div className="h-10 bg-bg-secondary flex items-center select-none rounded-lg overflow-hidden px-4">
          <p className="text-sm font-semibold text-text-secondary pointer-events-none">{t('library.splash.brand')}</p>
        </div>
      </div>
    );
  }

  if (!osPlatform || isMobile) {
    return null;
  }
  const outerDragProps = isLinux ? {} : { 'data-tauri-drag-region': 'true' };

  return (
    <div className="relative pt-2 px-2 w-full z-50 bg-transparent" {...outerDragProps}>
      <div
        className="h-10 bg-bg-secondary flex justify-between items-center select-none rounded-lg overflow-hidden"
        {...outerDragProps}
      >
        <div className="flex items-center h-full">
          {isMac && (
            <div className="flex items-center h-full px-4 space-x-2 z-10">
              <button
                aria-label={t('window.titleBar.close')}
                className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors duration-150"
                onClick={handleClose}
              />
              <button
                aria-label={t('window.titleBar.minimize')}
                className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors duration-150"
                onClick={handleMinimize}
              />
              <button
                aria-label={t('window.titleBar.maximize')}
                className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 transition-colors duration-150"
                onClick={handleMaximize}
              />
            </div>
          )}
          <div data-tauri-drag-region className={`flex items-center h-full ${isMac ? '' : 'px-4'}`}>
            <p className="text-sm font-semibold text-text-secondary pointer-events-none">{t('library.splash.brand')}</p>
          </div>
        </div>
        <div data-tauri-drag-region className="flex-1 h-full" />
        <div className="flex items-center h-full z-10">
          {isLinux && (
            <div className="flex items-center gap-2 pr-2 h-full">
              <button
                aria-label={t('window.titleBar.minimize')}
                className="w-7 h-7 rounded-full inline-flex justify-center items-center hover:bg-white/10 transition-colors duration-150"
                onClick={handleMinimize}
              >
                <Minus size={16} className="text-text-secondary" />
              </button>
              <button
                aria-label={t('window.titleBar.maximize')}
                className="w-7 h-7 rounded-full inline-flex justify-center items-center hover:bg-white/10 transition-colors duration-150"
                onClick={handleMaximize}
              >
                {isMaximized ? (
                  <RestoreDownIcon size={13} className="text-text-secondary" />
                ) : (
                  <Square size={13} className="text-text-secondary" />
                )}
              </button>
              <button
                aria-label={t('window.titleBar.close')}
                className="w-7 h-7 rounded-full inline-flex justify-center items-center hover:bg-red-500 hover:text-white transition-colors duration-150"
                onClick={handleClose}
              >
                <X size={16} className="text-text-secondary hover:text-white" />
              </button>
            </div>
          )}

          {isWindows && <div data-tauri-drag-region className="w-36 shrink-0 h-full pointer-events-none" />}
        </div>
      </div>

      {isWindows && (
        <div className="absolute top-0 right-0 flex h-12 z-20">
          <button
            aria-label={t('window.titleBar.minimize')}
            className="relative w-12 group outline-none"
            onClick={handleMinimize}
          >
            <div className="absolute bottom-0 left-0 w-12 h-10 flex justify-center items-center group-hover:bg-white/10 group-active:bg-white/20 transition-colors duration-150">
              <Minus size={16} className="text-text-secondary" />
            </div>
          </button>

          <button
            aria-label={t('window.titleBar.maximize')}
            className="relative w-12 group outline-none"
            onClick={handleMaximize}
          >
            <div className="absolute bottom-0 left-0 w-12 h-10 flex justify-center items-center group-hover:bg-white/10 group-active:bg-white/20 transition-colors duration-150">
              {isMaximized ? (
                <RestoreDownIcon size={12} className="text-text-secondary" />
              ) : (
                <Square size={12} className="text-text-secondary" />
              )}
            </div>
          </button>

          <button
            aria-label={t('window.titleBar.close')}
            className="relative w-14 group outline-none"
            onClick={handleClose}
          >
            <div className="absolute bottom-0 left-0 w-12 h-10 flex justify-center items-center group-hover:bg-red-500 group-active:bg-red-600 transition-colors duration-150 rounded-r-lg">
              <X size={16} className="text-text-secondary group-hover:text-white transition-colors duration-150" />
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
