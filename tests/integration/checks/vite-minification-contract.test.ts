import { describe, expect, test } from 'bun:test';
import { loadConfigFromFile } from 'vite';
import { z } from 'zod';

const viteBuildContractSchema = z
  .object({
    cssMinify: z.union([z.boolean(), z.string()]).optional(),
    minify: z.union([z.boolean(), z.string()]).optional(),
    sourcemap: z.union([z.boolean(), z.string()]).optional(),
  })
  .passthrough();

type ViteBuildContract = z.infer<typeof viteBuildContractSchema>;

async function loadBuildConfig(debug: boolean): Promise<ViteBuildContract> {
  const previousDebug = process.env.TAURI_ENV_DEBUG;
  if (debug) {
    process.env.TAURI_ENV_DEBUG = '1';
  } else {
    delete process.env.TAURI_ENV_DEBUG;
  }

  try {
    const loaded = await loadConfigFromFile(
      {
        command: 'build',
        mode: 'production',
      },
      'vite.config.js',
    );
    if (loaded === null) throw new Error('Unable to load vite.config.js.');
    return viteBuildContractSchema.parse(loaded.config.build ?? {});
  } finally {
    if (previousDebug === undefined) {
      delete process.env.TAURI_ENV_DEBUG;
    } else {
      process.env.TAURI_ENV_DEBUG = previousDebug;
    }
  }
}

describe('Vite minification contract', () => {
  test('normal and debug production builds keep minification enabled', async () => {
    const normalBuild = await loadBuildConfig(false);
    const debugBuild = await loadBuildConfig(true);

    for (const [label, build] of [
      ['normal', normalBuild],
      ['debug', debugBuild],
    ] as const) {
      expect(build.minify, `${label}: build.minify`).toBe('oxc');
      expect(build.cssMinify, `${label}: build.cssMinify`).not.toBe(false);
    }
  });

  test('sourcemaps are enabled only for Tauri debug builds', async () => {
    await expect(loadBuildConfig(false)).resolves.toMatchObject({ sourcemap: false });
    await expect(loadBuildConfig(true)).resolves.toMatchObject({ sourcemap: true });
  });

  test('self-test detects disabled minification mutations', () => {
    const mutatedBuild = viteBuildContractSchema.parse({
      cssMinify: false,
      minify: false,
      sourcemap: true,
    });

    expect(mutatedBuild.minify).toBe(false);
    expect(mutatedBuild.cssMinify).toBe(false);
  });
});
