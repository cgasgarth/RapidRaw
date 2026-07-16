import { startApplication } from './product/startupBootstrap';

declare const __RAWENGINE_BROWSER_TAURI_HARNESS__: boolean | undefined;

const launchApplication = async (): Promise<void> => {
  if (typeof __RAWENGINE_BROWSER_TAURI_HARNESS__ === 'boolean' && __RAWENGINE_BROWSER_TAURI_HARNESS__) {
    const { installBrowserTauriHarness } = await import('./validation/browserTauriHarness.mts');
    installBrowserTauriHarness();
  }
  await startApplication();
};

void launchApplication();
