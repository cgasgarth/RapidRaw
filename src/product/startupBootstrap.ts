import { queueStartupShellIntent, staticStartupState } from './startupShellHandoff';

type StartupPhase = 'interactive' | 'shellVisible';
type StartupStatus = 'failed' | 'ok';

interface StartupSnapshot {
  processId: number;
  traceId: string;
}

interface TauriInternals {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
}

const commands = {
  frontendReady: 'frontend_ready',
  getTrace: 'get_startup_trace',
  recordPhase: 'record_frontend_startup_phase',
} as const;

const snapshotIdentity = (value: unknown): StartupSnapshot => {
  if (typeof value !== 'object' || value === null) throw new Error('startup_trace_invalid_snapshot');
  const record = value as Record<string, unknown>;
  if (typeof record['traceId'] !== 'string' || !record['traceId'].startsWith('startup:')) {
    throw new Error('startup_trace_invalid_identity');
  }
  if (typeof record['processId'] !== 'number' || !Number.isInteger(record['processId']) || record['processId'] <= 0) {
    throw new Error('startup_trace_invalid_process');
  }
  return { processId: record['processId'], traceId: record['traceId'] };
};

const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const bridge = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!bridge) throw new Error('startup_tauri_bridge_unavailable');
  return bridge.invoke<T>(command, args);
};

const record = async (traceId: string, phase: StartupPhase, status: StartupStatus, detail: string): Promise<void> => {
  const response = snapshotIdentity(await invoke<unknown>(commands.recordPhase, { detail, phase, status, traceId }));
  if (response.traceId !== traceId) throw new Error('startup_trace_correlation_mismatch');
};

const showRecovery = (error: unknown): void => {
  const content = document.getElementById('startup-shell-content');
  if (!content) return;
  content.replaceChildren();
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = 'RapidRAW could not finish loading. Restart the application to try again.';
  content.append(message);
  console.error('Failed to load full application:', error);
};

const attachIntent = (id: string, intent: 'add-folder' | 'settings'): void => {
  document.getElementById(id)?.addEventListener('click', () => queueStartupShellIntent(intent), { once: true });
};

export const completeStaticStartup = async (): Promise<string> => {
  attachIntent('startup-add-folder', 'add-folder');
  attachIntent('startup-settings', 'settings');
  await invoke<void>(commands.frontendReady);
  const snapshot = snapshotIdentity(await invoke<unknown>(commands.getTrace));
  await record(snapshot.traceId, 'shellVisible', 'ok', 'static-library-shell-visible');
  await record(snapshot.traceId, 'interactive', 'ok', 'static-shell-handlers-and-ipc-ready');
  return snapshot.traceId;
};

let staticStartupPromise: Promise<string> | null = null;

export const beginStaticStartup = (): Promise<string> => {
  staticStartupPromise ??= staticStartupState()?.receipt ?? completeStaticStartup();
  return staticStartupPromise;
};

export const startApplication = async (
  loadApplication: () => Promise<{ mountApplication: () => void }> = () => import('../mainApp.js'),
  establishStartup: () => Promise<string> = beginStaticStartup,
): Promise<void> => {
  try {
    await establishStartup();
    const application = await loadApplication();
    application.mountApplication();
  } catch (error) {
    showRecovery(error);
  }
};

export const startupBootstrapCommands = commands;
