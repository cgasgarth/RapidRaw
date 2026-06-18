#!/usr/bin/env bun

const timeoutMs = Number.parseInt(process.env.RAWENGINE_AI_DENOISE_SMOKE_TIMEOUT_MS ?? '180000', 10);
const command = [
  'cargo',
  'test',
  '--quiet',
  'ai_denoise_headless_smoke_uses_real_nind_model_when_configured',
  '--no-default-features',
  '--features',
  'required-ci',
  '--',
  '--nocapture',
];

const child = Bun.spawn(command, {
  cwd: 'src-tauri',
  stderr: 'pipe',
  stdout: 'pipe',
});
let timeoutId: ReturnType<typeof setTimeout> | undefined;
const timeout = new Promise<'timeout'>((resolve) => {
  timeoutId = setTimeout(() => resolve('timeout'), timeoutMs);
});
const result = await Promise.race([child.exited, timeout]);
if (timeoutId !== undefined) clearTimeout(timeoutId);

if (result === 'timeout') {
  child.kill();
  console.error(`ai-denoise-nind-headless-smoke timed out after ${timeoutMs}ms`);
  process.exit(1);
}

const stdout = await new Response(child.stdout).text();
const stderr = await new Response(child.stderr).text();
if (result !== 0) {
  console.error('ai-denoise-nind-headless-smoke failed');
  console.error([stdout, stderr].join('\n').trim().split('\n').slice(-20).join('\n'));
  process.exit(result);
}

console.log('ai-denoise-nind-headless-smoke ok');
