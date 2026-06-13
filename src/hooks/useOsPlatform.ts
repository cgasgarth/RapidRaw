import { platform } from '@tauri-apps/plugin-os';
import { useMemo } from 'react';

export function useOsPlatform() {
  return useMemo(() => {
    try {
      return platform();
    } catch (_error) {
      return '';
    }
  }, []);
}
