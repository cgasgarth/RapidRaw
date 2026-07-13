import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StartupShell } from '../../../src/product/StartupShell';
import {
  consumeStartupShellIntent,
  loadStartupApp,
  queueStartupShellIntent,
} from '../../../src/product/startupShellHandoff';

describe('startup shell handoff', () => {
  test('preserves queued input until the full application chunk is ready', async () => {
    queueStartupShellIntent('settings');
    let resolveModule: ((module: { default: string }) => void) | undefined;
    const loading = loadStartupApp(
      () =>
        new Promise<{ default: string }>((resolve) => {
          resolveModule = resolve;
        }),
    );

    expect(consumeStartupShellIntent()).toBe('settings');
    queueStartupShellIntent('settings');
    resolveModule?.({ default: 'full-app' });
    expect(await loading).toEqual({ module: { default: 'full-app' }, status: 'ready' });
    expect(consumeStartupShellIntent()).toBe('settings');
    expect(consumeStartupShellIntent()).toBeNull();
  });

  test('returns an explicit failure while leaving queued recovery input intact', async () => {
    queueStartupShellIntent('add-folder');
    const result = await loadStartupApp(() => Promise.reject(new Error('chunk unavailable')));
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.error.message).toBe('chunk unavailable');
    expect(consumeStartupShellIntent()).toBe('add-folder');
  });

  test('renders accessible interactive and failure shells', () => {
    const interactive = renderToStaticMarkup(<StartupShell />);
    expect(interactive).toContain('aria-label="RapidRAW library is starting"');
    expect(interactive).toContain('Add Folder');
    expect(interactive).toContain('Settings');

    const failed = renderToStaticMarkup(<StartupShell failed />);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Restart the application to try again.');
  });
});
