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
export default defineConfig(async () => ({
  ...(process.env.RAWENGINE_VITE_CACHE_DIR === undefined ? {} : { cacheDir: process.env.RAWENGINE_VITE_CACHE_DIR }),
  plugins: [
    createViteProductBundleGuardPlugin(),
    browserTauriHarnessPrebootPlugin(),
    startupPrebootOrderingPlugin(),
    browserTauriHarnessEntryPlugin(),
    tailwindcss(),
    react(),
  ],
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

function startupPrebootOrderingPlugin() {
  return {
    name: 'rapidraw-startup-preboot-ordering',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const prebootOffset = html.indexOf('data-rawengine-startup-preboot');
        const moduleMatch = html.match(/\s*<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/u);
        if (!moduleMatch || prebootOffset < 0 || (moduleMatch.index ?? 0) > prebootOffset) return html;
        return html.replace(moduleMatch[0], '').replace('</body>', `${moduleMatch[0].trim()}\n  </body>`);
      },
    },
  };
}

function browserTauriHarnessEntryPlugin() {
  return {
    name: 'rapidraw-browser-tauri-harness-entry',
    apply: 'serve',
    transform(source, id) {
      if (!id.endsWith('/src/main.ts')) return;
      return [
        'import { installBrowserTauriHarness } from "/src/validation/browserTauriHarness.mts";',
        'installBrowserTauriHarness();',
        source,
      ].join('\n');
    },
  };
}

function browserTauriHarnessPrebootPlugin() {
  return {
    name: 'rapidraw-browser-tauri-harness-preboot',
    apply: 'serve',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const marker = '<script data-rawengine-startup-preboot>';
        if (!html.includes(marker)) return html;
        const bootstrap = `<script data-rawengine-browser-tauri-bootstrap>
      (() => {
        if (window.__TAURI_INTERNALS__ !== undefined) return;
        const trace = {
          criticalPathOrderValid: true,
          firstPaintBudgetMet: true,
          firstPaintBudgetMs: 750,
          processId: 12345,
          traceId: "startup:browser-harness",
          phases: [],
        };
        const queuedCalls = [];
        window.isTauri = true;
        window.__TAURI_INTERNALS__ = {
          __rawengineBrowserBootstrap: true,
          __rawengineQueuedCalls: queuedCalls,
          convertFileSrc: (path) => path,
          invoke: (command, args, options) => {
            const startedAtMs = performance.now();
            queuedCalls.push({ args, command, endedAtMs: performance.now(), options, startedAtMs });
            if (command === "frontend_ready") return Promise.resolve(null);
            if (command === "get_startup_trace") return Promise.resolve(trace);
            if (command === "record_frontend_startup_phase") {
              return Promise.resolve({ ...trace, phases: [{ ...args, elapsedMs: 0 }] });
            }
            return Promise.reject(new Error("browser_tauri_harness_not_ready:" + command));
          },
          transformCallback: () => 0,
          unregisterCallback: () => {},
        };
      })();
    </script>`;
        return html.replace(marker, `${bootstrap}\n    ${marker}`);
      },
    },
  };
}
