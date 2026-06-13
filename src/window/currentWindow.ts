import { getCurrentWindow } from '@tauri-apps/api/window';

export type CurrentTauriWindow = ReturnType<typeof getCurrentWindow>;

export const getOptionalCurrentWindow = (): CurrentTauriWindow | null => {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
};
