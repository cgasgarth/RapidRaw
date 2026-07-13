export type StartupShellIntent = 'add-folder' | 'settings';

let pendingIntent: StartupShellIntent | null = null;

interface StaticStartupState {
  intent: StartupShellIntent | null;
  receipt: Promise<string> | null;
}

export const staticStartupState = (): StaticStartupState | undefined =>
  (globalThis as typeof globalThis & { __RAWENGINE_STATIC_STARTUP__?: StaticStartupState })
    .__RAWENGINE_STATIC_STARTUP__;

export const queueStartupShellIntent = (intent: StartupShellIntent): void => {
  pendingIntent = intent;
  const state = staticStartupState();
  if (state) state.intent = intent;
};

export const consumeStartupShellIntent = (): StartupShellIntent | null => {
  const state = staticStartupState();
  const intent = pendingIntent ?? state?.intent ?? null;
  pendingIntent = null;
  if (state) state.intent = null;
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
