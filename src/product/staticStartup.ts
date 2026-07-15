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

export const startupBootstrapCommands = {
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
  const response = snapshotIdentity(
    await invoke<unknown>(startupBootstrapCommands.recordPhase, { detail, phase, status, traceId }),
  );
  if (response.traceId !== traceId) throw new Error('startup_trace_correlation_mismatch');
};

const attachIntent = (id: string, intent: 'add-folder' | 'settings'): void => {
  document.getElementById(id)?.addEventListener('click', () => queueStartupShellIntent(intent), { once: true });
};

export const completeStaticStartup = async (): Promise<string> => {
  attachIntent('startup-add-folder', 'add-folder');
  attachIntent('startup-settings', 'settings');
  const frontendReadyStartedAt = performance.now();
  await invoke<void>(startupBootstrapCommands.frontendReady);
  const frontendReadyMs = Math.ceil(performance.now() - frontendReadyStartedAt);
  const snapshot = snapshotIdentity(await invoke<unknown>(startupBootstrapCommands.getTrace));
  await record(
    snapshot.traceId,
    'shellVisible',
    'ok',
    `static-library-shell-visible:frontend_ready_ms=${frontendReadyMs}`,
  );
  await record(snapshot.traceId, 'interactive', 'ok', 'static-shell-handlers-and-ipc-ready');
  return snapshot.traceId;
};

let staticStartupPromise: Promise<string> | null = null;

export const beginStaticStartup = (): Promise<string> => {
  staticStartupPromise ??= staticStartupState()?.receipt ?? completeStaticStartup();
  return staticStartupPromise;
};
