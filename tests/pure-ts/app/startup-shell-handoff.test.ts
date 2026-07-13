import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  completeStaticStartup,
  startApplication,
  startupBootstrapCommands,
} from '../../../src/product/startupBootstrap';
import { consumeStartupShellIntent } from '../../../src/product/startupShellHandoff';

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const installShell = (invoke: Invoke): Window => {
  const testWindow = new Window({ url: 'http://localhost' });
  testWindow.document.body.innerHTML = `
    <div id="root"><div id="startup-shell" role="status" aria-label="RapidRAW library is starting">
      <div id="startup-shell-content"><p>Loading your workspace…</p>
        <button id="startup-add-folder" type="button">Add Folder</button>
        <button id="startup-settings" type="button">Settings</button>
      </div>
    </div></div>`;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: testWindow.document });
  Object.defineProperty(testWindow, '__TAURI_INTERNALS__', { configurable: true, value: { invoke } });
  return testWindow;
};

const trace = (traceId = 'startup:trace-42') => ({ processId: 4242, traceId });

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
  while (consumeStartupShellIntent() !== null) {
    // Drain input state shared with the deferred application chunk.
  }
});

describe('static startup shell handoff', () => {
  test('is interactive before native receipts and loads React only after their correlation completes', async () => {
    const calls: Array<{ args?: Record<string, unknown>; command: string }> = [];
    let releaseInteractive: (() => void) | undefined;
    const interactiveReceipt = new Promise<void>((resolve) => {
      releaseInteractive = resolve;
    });
    const invoke: Invoke = async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ args, command });
      if (command === startupBootstrapCommands.frontendReady) return undefined as T;
      if (command === startupBootstrapCommands.getTrace) return trace() as T;
      if (args?.['phase'] === 'interactive') await interactiveReceipt;
      return trace() as T;
    };
    const testWindow = installShell(invoke);
    const mount = mock(() => undefined);
    const load = mock(async () => ({ mountApplication: mount }));

    const startup = startApplication(load, completeStaticStartup);
    testWindow.document.getElementById('startup-settings')?.click();
    expect(consumeStartupShellIntent()).toBe('settings');
    await Bun.sleep(0);
    expect(load).not.toHaveBeenCalled();
    releaseInteractive?.();
    await startup;

    expect(calls.map(({ command }) => command)).toEqual([
      'frontend_ready',
      'get_startup_trace',
      'record_frontend_startup_phase',
      'record_frontend_startup_phase',
    ]);
    expect(
      calls
        .slice(2)
        .map(({ args }) => args?.['phase'])
        .sort(),
    ).toEqual(['interactive', 'shellVisible']);
    expect(calls.slice(2).every(({ args }) => args?.['traceId'] === 'startup:trace-42')).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(1);
  });

  test('rejects crossed trace identity and leaves an accessible recovery shell without loading React', async () => {
    const errorLog = mock(() => undefined);
    const originalError = console.error;
    console.error = errorLog;
    try {
      installShell(async <T>(command: string) => {
        if (command === startupBootstrapCommands.frontendReady) return undefined as T;
        if (command === startupBootstrapCommands.getTrace) return trace('startup:expected') as T;
        return trace('startup:stale') as T;
      });
      const load = mock(async () => ({ mountApplication: mock(() => undefined) }));
      await startApplication(load, completeStaticStartup);

      expect(load).not.toHaveBeenCalled();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('Restart the application');
      expect(errorLog).toHaveBeenCalledTimes(1);
    } finally {
      console.error = originalError;
    }
  });

  test('preserves Add Folder input for the deferred application', async () => {
    const testWindow = installShell(async <T>(command: string) => {
      if (command === startupBootstrapCommands.frontendReady) return undefined as T;
      return trace() as T;
    });
    await completeStaticStartup();
    testWindow.document.getElementById('startup-add-folder')?.click();
    expect(consumeStartupShellIntent()).toBe('add-folder');
  });
});
