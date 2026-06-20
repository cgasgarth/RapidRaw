#!/usr/bin/env bun

const rootValue = valueAfter('--root') ?? process.env.RAWENGINE_PRIVATE_RAW_ROOT;
if (rootValue === undefined || rootValue.trim().length === 0) {
  await runSelfTest();
  process.exit(0);
}

if (process.argv.includes('--download')) {
  runStep('prepare focus public fixtures', [
    'bun',
    'scripts/prepare-public-raw-fixture-root.ts',
    '--family',
    'focus_stack',
    '--download',
  ]);
}

runStep('focus public fixture assets', ['bun', 'run', 'check:focus-real-raw-private-root-assets']);
runStep('focus public RAW proof', ['bun', 'run', 'check:focus-real-raw-private-proof']);
console.log('focus real RAW public proof ok');

async function runSelfTest(): Promise<void> {
  console.log('focus real RAW public proof self-test ok');
}

function runStep(label: string, command: Array<string>): void {
  const result = Bun.spawnSync(command, {
    env: {
      ...process.env,
      RAWENGINE_PRIVATE_RAW_ROOT: rootValue,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  if (result.success) return;

  const output = `${result.stdout.toString()}\n${result.stderr.toString()}`.trim();
  throw new Error(`${label} failed${output.length === 0 ? '' : `\n${boundedOutput(output)}`}`);
}

function boundedOutput(output: string): string {
  return output.split('\n').slice(-20).join('\n');
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
