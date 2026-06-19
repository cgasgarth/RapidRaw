#!/usr/bin/env bun

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

const failures: string[] = [];

const normalBuild = await loadBuildConfig(false);
const debugBuild = await loadBuildConfig(true);

assertMinificationEnabled('normal', normalBuild);
assertMinificationEnabled('debug', debugBuild);
assertSourcemap('normal', normalBuild, false);
assertSourcemap('debug', debugBuild, true);
assertMutationFails();

if (failures.length > 0) {
  console.error('vite minification contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('vite minification contract ok');

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

function assertMinificationEnabled(label: string, build: ViteBuildContract): void {
  if (build.minify === false) failures.push(`${label}: build.minify must not be false.`);
  if (build.minify !== 'oxc') failures.push(`${label}: build.minify expected oxc, got ${String(build.minify)}.`);
  if (build.cssMinify === false) failures.push(`${label}: build.cssMinify must not be false.`);
}

function assertSourcemap(label: string, build: ViteBuildContract, expected: boolean): void {
  if (build.sourcemap !== expected) {
    failures.push(`${label}: build.sourcemap expected ${String(expected)}, got ${String(build.sourcemap)}.`);
  }
}

function assertMutationFails(): void {
  const mutationFailures: string[] = [];
  const mutatedBuild = viteBuildContractSchema.parse({
    cssMinify: false,
    minify: false,
    sourcemap: true,
  });

  if (mutatedBuild.minify === false) mutationFailures.push('mutated: build.minify must not be false.');
  if (mutatedBuild.cssMinify === false) mutationFailures.push('mutated: build.cssMinify must not be false.');
  if (!mutationFailures.some((failure) => failure.includes('build.minify'))) {
    failures.push('self-test: minify=false mutation did not produce a build.minify failure.');
  }
  if (!mutationFailures.some((failure) => failure.includes('build.cssMinify'))) {
    failures.push('self-test: cssMinify=false mutation did not produce a build.cssMinify failure.');
  }
}
