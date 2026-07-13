import { resolve } from 'node:path';

const action = process.argv[2];
const profile = process.argv[3];
if ((action !== 'check' && action !== 'run') || (profile !== 'fast-dev' && profile !== 'full')) {
  throw new Error('usage: bun scripts/dev/native-profile.ts <check|run> <fast-dev|full>');
}

const root = resolve(import.meta.dir, '../..');
const targetDir = resolve(root, 'src-tauri/target', profile);
const profileArgs =
  profile === 'fast-dev'
    ? ['--no-default-features', '--features', 'fast-dev']
    : ['--no-default-features', '--features', 'full,required-ci'];
const cargo = Bun.spawn(
  ['cargo', action, '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--target-dir', targetDir, ...profileArgs],
  { cwd: root, stderr: 'inherit', stdout: 'inherit' },
);

const vite =
  action === 'run' ? Bun.spawn(['bun', 'run', 'dev'], { cwd: root, stderr: 'inherit', stdout: 'inherit' }) : null;

const shutdown = (): void => {
  cargo.kill();
  vite?.kill();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const exitCode = await cargo.exited;
vite?.kill();
process.exit(exitCode);
