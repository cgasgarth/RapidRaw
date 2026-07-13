export type StartupShellIntent = 'add-folder' | 'settings';

let pendingIntent: StartupShellIntent | null = null;

export const queueStartupShellIntent = (intent: StartupShellIntent): void => {
  pendingIntent = intent;
};

export const consumeStartupShellIntent = (): StartupShellIntent | null => {
  const intent = pendingIntent;
  pendingIntent = null;
  return intent;
};

export type StartupAppLoadResult<T> = { module: T; status: 'ready' } | { error: Error; status: 'failed' };

export const loadStartupApp = async <T>(loader: () => Promise<T>): Promise<StartupAppLoadResult<T>> => {
  try {
    return { module: await loader(), status: 'ready' };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)), status: 'failed' };
  }
};
