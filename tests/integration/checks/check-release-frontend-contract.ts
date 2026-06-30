#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const PackageJsonSchema = z
  .object({
    scripts: z.record(z.string(), z.string()),
  })
  .passthrough();

const TauriConfigSchema = z
  .object({
    build: z
      .object({
        beforeBuildCommand: z.string(),
        frontendDist: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

const failures: string[] = [];

const [packageJson, tauriConfig, viteConfig, buildWorkflow] = await Promise.all([
  readJson('package.json', PackageJsonSchema),
  readJson('src-tauri/tauri.conf.json', TauriConfigSchema),
  readFile('vite.config.js', 'utf8'),
  readFile('.github/workflows/build.yml', 'utf8'),
]);

expectEqual(
  packageJson.scripts.build,
  'bun scripts/run-compact-command.ts --label build -- vite build',
  'package build script must run the compact Vite production build.',
);
expectIncludes(
  packageJson.scripts['check:bundle'],
  'check-vite-minification-contract.ts',
  'check:bundle must enforce minification.',
);
expectIncludes(
  packageJson.scripts['check:bundle'],
  'bun run build',
  'check:bundle must build the measured frontend artifact.',
);
expectIncludes(
  packageJson.scripts['check:bundle'],
  'check-vite-bundle-budget.ts',
  'check:bundle must enforce the measured budget.',
);

expectEqual(
  tauriConfig.build.beforeBuildCommand,
  'bun run build',
  'Tauri packaging must invoke the package build contract.',
);
expectEqual(tauriConfig.build.frontendDist, '../dist', 'Tauri packaging must consume the same dist directory.');

expectIncludes(viteConfig, "minify: 'oxc'", 'Vite release builds must use Oxc JavaScript minification.');
expectIncludes(viteConfig, "cssMinify: 'esbuild'", 'Vite release builds must keep CSS minification enabled.');
expectIncludes(viteConfig, 'sourcemap: !!process.env.TAURI_ENV_DEBUG', 'TAURI_ENV_DEBUG may control sourcemaps only.');

expectIncludes(
  buildWorkflow,
  'tauri-apps/tauri-action',
  'Desktop release packaging must continue through Tauri packaging.',
);
expectIncludes(buildWorkflow, 'Generate release checksums', 'Release packaging must emit reviewable metadata.');

if (failures.length > 0) {
  console.error('release frontend contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('release frontend contract ok');

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(path, 'utf8')));
}

function expectEqual(actual: string | undefined, expected: string, message: string): void {
  if (actual !== expected)
    failures.push(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
}

function expectIncludes(actual: string | undefined, expected: string, message: string): void {
  if (actual === undefined || !actual.includes(expected)) {
    failures.push(`${message} Missing ${JSON.stringify(expected)}.`);
  }
}
