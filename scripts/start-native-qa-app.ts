#!/usr/bin/env bun

const appPath = 'src-tauri/target/debug/bundle/macos/RapidRAW.app';
const args = process.argv.slice(2);
const shouldBuild = !args.includes('--no-build');

async function run(command: string, commandArgs: string[], label: string): Promise<void> {
  const proc = Bun.spawn([command, ...commandArgs], {
    stderr: 'pipe',
    stdout: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode === 0) return;

  console.error(`${label} failed`);
  const output = `${stdout}\n${stderr}`.trim();
  console.error(output.split('\n').slice(-40).join('\n'));
  process.exit(exitCode);
}

if (shouldBuild) {
  await run(
    'bun',
    ['tauri', 'build', '--debug', '--ci', '--bundles', 'app', '--features', 'required-ci'],
    'native qa app build',
  );
}

await run('open', [appPath], 'native qa app launch');
console.log(`native qa app ok (${appPath})`);
