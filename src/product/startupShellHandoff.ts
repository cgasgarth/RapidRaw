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

export const loadStartupAppAfterShellReceipt = async <T>(
  shellReceipt: Promise<unknown>,
  loader: () => Promise<T>,
): Promise<StartupAppLoadResult<T>> => {
  try {
    await shellReceipt;
  } catch {
    // Trace reporting must never prevent the recoverable full-app handoff.
  }
  return loadStartupApp(loader);
};
