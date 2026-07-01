import { installFrontendLogBridge } from './utils/frontendLogBridge';
import { installBrowserTauriHarness } from './validation/browserTauriHarness.mts';
import './product-styles.css';

installBrowserTauriHarness();
installFrontendLogBridge();
void import('./validation/browser/AppBootstrap.tsx');
