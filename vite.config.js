import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { getViteChunkSizeWarningLimitKb } from './scripts/lib/ci/vite-bundle-policy.ts';
import { createViteProductBundleGuardPlugin } from './scripts/lib/ci/vite-product-bundle-guard.ts';
import { parseTcpPort } from './scripts/lib/dev-server-port.ts';

const host = process.env.TAURI_DEV_HOST;
const devServerPort =
  process.env.RAWENGINE_DEV_SERVER_PORT === undefined
    ? 1420
    : parseTcpPort(process.env.RAWENGINE_DEV_SERVER_PORT, 'RAWENGINE_DEV_SERVER_PORT');
const hmrPort =
  process.env.RAWENGINE_DEV_SERVER_HMR_PORT === undefined
    ? devServerPort + 1
    : parseTcpPort(process.env.RAWENGINE_DEV_SERVER_HMR_PORT, 'RAWENGINE_DEV_SERVER_HMR_PORT');

// https://vitejs.dev/config/
export default defineConfig(async ({ command }) => ({
  plugins: [createViteProductBundleGuardPlugin(), browserTauriHarnessDevPlugin(command), tailwindcss(), react()],
  define: {
    __RAWENGINE_BROWSER_TAURI_HARNESS__: JSON.stringify(
      command === 'serve' || process.env.VITE_RAWENGINE_BROWSER_TAURI_HARNESS === '1',
    ),
  },

  clearScreen: false,
  server: {
    port: devServerPort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: hmrPort,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },

  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    cssMinify: 'esbuild',
    manifest: true,
    minify: 'oxc',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: getViteChunkSizeWarningLimitKb(),
  },
}));

function browserTauriHarnessDevPlugin(command) {
  return {
    name: 'rapidraw-browser-tauri-harness-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      if (command !== 'serve') return html;

      const harnessScript = [
        '    <script type="module">',
        '      import { installBrowserTauriHarness } from "/src/validation/browserTauriHarness.mts";',
        '      installBrowserTauriHarness();',
        '    </script>',
      ].join('\n');

      return html.replace(
        '    <script type="module" src="/src/main.ts"></script>',
        [harnessScript, '    <script type="module" src="/src/main.ts"></script>'].join('\n'),
      );
    },
  };
}
