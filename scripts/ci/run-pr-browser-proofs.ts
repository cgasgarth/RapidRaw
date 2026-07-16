#!/usr/bin/env bun

import { resolve } from 'node:path';

export interface BrowserProof {
  command: readonly string[];
  label: string;
}

export type BrowserProofExecutor = (proof: BrowserProof) => Promise<number>;

export const PR_BROWSER_PROOFS: readonly BrowserProof[] = [
  {
    command: ['bun', 'scripts/proofs/capture-visual-smoke.ts', '--scenario', 'empty-library'],
    label: 'visual-smoke',
  },
  {
    command: ['bun', 'tests/integration/checks/check-browser-tauri-harness.ts'],
    label: 'browser-tauri-harness',
  },
  {
    command: ['bun', 'tests/integration/checks/editor/check-section-disclosure-edit-authority-browser.ts'],
    label: 'section-disclosure-authority',
  },
];

const compactRunner = resolve(import.meta.dir, 'run-compact-command.ts');

export function browserProofEnvironment(label: string): Record<string, string | undefined> {
  const runnerTemp = Reflect.get(process.env, 'RUNNER_TEMP');
  const temporaryRoot = typeof runnerTemp === 'string' ? runnerTemp : '/tmp';
  return {
    ...process.env,
    RAWENGINE_VITE_CACHE_DIR: resolve(temporaryRoot, 'rapidraw-pr-browser-proofs', label),
  };
}

export const executeBrowserProof: BrowserProofExecutor = async ({ command, label }) => {
  const child = Bun.spawn(['bun', compactRunner, '--label', label, '--', ...command], {
    env: browserProofEnvironment(label),
    stderr: 'inherit',
    stdout: 'inherit',
  });
  return child.exited;
};

export async function runPrBrowserProofs(execute: BrowserProofExecutor = executeBrowserProof): Promise<void> {
  const results = await Promise.all(
    PR_BROWSER_PROOFS.map(async (proof) => ({ exitCode: await execute(proof), label: proof.label })),
  );
  const failures = results.filter(({ exitCode }) => exitCode !== 0);
  if (failures.length > 0) {
    throw new Error(
      `PR browser proofs failed: ${failures.map(({ exitCode, label }) => `${label} (exit=${String(exitCode)})`).join(', ')}`,
    );
  }
}

if (import.meta.main) {
  try {
    await runPrBrowserProofs();
    console.log(`pr browser proofs ok (${String(PR_BROWSER_PROOFS.length)} concurrent)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
