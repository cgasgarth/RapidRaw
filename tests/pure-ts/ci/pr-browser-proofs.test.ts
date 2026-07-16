import { expect, test } from 'bun:test';

import {
  type BrowserProof,
  browserProofEnvironment,
  PR_BROWSER_PROOFS,
  runPrBrowserProofs,
} from '../../../scripts/ci/run-pr-browser-proofs';

test('isolates concurrent Vite dependency optimizer state', () => {
  const environments = PR_BROWSER_PROOFS.map(({ label }) => browserProofEnvironment(label));
  const cacheDirectories = environments.map(({ RAWENGINE_VITE_CACHE_DIR }) => RAWENGINE_VITE_CACHE_DIR);
  expect(new Set(cacheDirectories).size).toBe(PR_BROWSER_PROOFS.length);
  expect(cacheDirectories.every((directory) => directory?.includes('rapidraw-pr-browser-proofs'))).toBeTrue();
});

test('starts every browser proof before awaiting completion', async () => {
  const started: string[] = [];
  const completions = new Map<string, PromiseWithResolvers<number>>();
  const running = runPrBrowserProofs(({ label }: BrowserProof) => {
    started.push(label);
    const completion = Promise.withResolvers<number>();
    completions.set(label, completion);
    return completion.promise;
  });

  await Bun.sleep(0);
  expect(started).toEqual(PR_BROWSER_PROOFS.map(({ label }) => label));
  for (const completion of completions.values()) completion.resolve(0);
  await expect(running).resolves.toBeUndefined();
});

test('awaits every browser proof and reports all failures', async () => {
  const completions = new Map<string, PromiseWithResolvers<number>>();
  let settled = false;
  const running = runPrBrowserProofs(({ label }) => {
    const completion = Promise.withResolvers<number>();
    completions.set(label, completion);
    return completion.promise;
  }).finally(() => {
    settled = true;
  });

  await Bun.sleep(0);
  completions.get('visual-smoke')?.resolve(1);
  completions.get('browser-tauri-harness')?.resolve(0);
  await Bun.sleep(0);
  expect(settled).toBeFalse();
  completions.get('section-disclosure-authority')?.resolve(2);
  await expect(running).rejects.toThrow(
    'PR browser proofs failed: visual-smoke (exit=1), section-disclosure-authority (exit=2)',
  );
});
