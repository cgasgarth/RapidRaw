import { describe, expect, test } from 'bun:test';
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

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(path, 'utf8')));
}

describe('release frontend build contract', () => {
  test('package scripts build and measure the Vite artifact', async () => {
    const packageJson = await readJson('package.json', PackageJsonSchema);

    expect(packageJson.scripts.build).toBe('bun scripts/run-compact-command.ts --label build -- vite build');
    expect(packageJson.scripts['check:bundle']).toContain('vite-minification-contract.test.ts');
    expect(packageJson.scripts['check:bundle']).toContain('bun run build');
    expect(packageJson.scripts['check:bundle']).toContain('check-vite-bundle-budget.ts');
  });

  test('Tauri packaging consumes the package build contract', async () => {
    const tauriConfig = await readJson('src-tauri/tauri.conf.json', TauriConfigSchema);

    expect(tauriConfig.build.beforeBuildCommand).toBe('bun run build');
    expect(tauriConfig.build.frontendDist).toBe('../dist');
  });

  test('Vite release builds keep minification and sourcemap policy', async () => {
    const viteConfig = await readFile('vite.config.js', 'utf8');

    expect(viteConfig).toContain("minify: 'oxc'");
    expect(viteConfig).toContain("cssMinify: 'esbuild'");
    expect(viteConfig).toContain('sourcemap: !!process.env.TAURI_ENV_DEBUG');
  });

  test('desktop release workflow still packages and emits metadata', async () => {
    const buildWorkflow = await readFile('.github/workflows/build.yml', 'utf8');

    expect(buildWorkflow).toContain('tauri-apps/tauri-action');
    expect(buildWorkflow).toContain('Generate release checksums');
  });
});
