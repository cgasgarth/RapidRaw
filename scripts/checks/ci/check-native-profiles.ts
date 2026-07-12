import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
const manifest = resolve(root, 'src-tauri/Cargo.toml');

const dependencySet = (features: string): Set<string> => {
  const result = Bun.spawnSync(
    [
      'cargo',
      'tree',
      '--locked',
      '--manifest-path',
      manifest,
      '-p',
      'RapidRAW',
      '--no-default-features',
      '--features',
      features,
      '--prefix',
      'none',
    ],
    { cwd: root, stderr: 'pipe', stdout: 'pipe' },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim());
  return new Set(
    result.stdout
      .toString()
      .split('\n')
      .map((line) => line.split(' ')[0])
      .filter(Boolean),
  );
};

const snapshotRuntimeArtifacts = async (): Promise<string[]> => {
  const resourceRoot = resolve(root, 'src-tauri/resources');
  const entries = await readdir(resourceRoot).catch(() => [] as string[]);
  const rows = await Promise.all(
    entries.sort().map(async (name) => {
      const metadata = await stat(resolve(resourceRoot, name));
      return `${name}:${metadata.size}:${metadata.mtimeMs}`;
    }),
  );
  return rows;
};

const checkProfile = async (profile: 'fast-dev' | 'full'): Promise<number> => {
  const started = performance.now();
  const features = profile === 'fast-dev' ? 'fast-dev' : 'full,required-ci';
  const targetDir = resolve(root, 'src-tauri/target/profile-gates', profile);
  const result = Bun.spawnSync(
    [
      'cargo',
      'build',
      '--locked',
      '--manifest-path',
      manifest,
      '--target-dir',
      targetDir,
      '--no-default-features',
      '--features',
      features,
    ],
    { cwd: root, stderr: 'pipe', stdout: 'pipe' },
  );
  if (result.exitCode !== 0) {
    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`.trim().split('\n').slice(-80).join('\n');
    throw new Error(`${profile} native profile failed:\n${output}`);
  }
  if (profile === 'fast-dev') {
    const tests = Bun.spawnSync(
      [
        'cargo',
        'test',
        '--locked',
        '--manifest-path',
        manifest,
        '--target-dir',
        targetDir,
        '-p',
        'RapidRAW',
        '--lib',
        '--no-default-features',
        '--features',
        features,
        'app::',
      ],
      { cwd: root, stderr: 'pipe', stdout: 'pipe' },
    );
    if (tests.exitCode !== 0) {
      const output = `${tests.stdout.toString()}\n${tests.stderr.toString()}`.trim().split('\n').slice(-80).join('\n');
      throw new Error(`fast-dev capability runtime tests failed:\n${output}`);
    }
  }
  return Math.round(performance.now() - started);
};

const fastDependencies = dependencySet('fast-dev');
const fullDependencies = dependencySet('full,required-ci');
for (const dependency of ['jxl-encoder', 'webp']) {
  if (fastDependencies.has(dependency)) throw new Error(`${dependency} leaked into fast-dev dependency graph.`);
  if (!fullDependencies.has(dependency)) throw new Error(`${dependency} missing from full dependency graph.`);
}
if (fastDependencies.size >= fullDependencies.size) {
  throw new Error(`fast-dev graph (${fastDependencies.size}) must be smaller than full (${fullDependencies.size}).`);
}

const beforeArtifacts = await snapshotRuntimeArtifacts();
const fastMillis = await checkProfile('fast-dev');
const afterFastArtifacts = await snapshotRuntimeArtifacts();
if (JSON.stringify(beforeArtifacts) !== JSON.stringify(afterFastArtifacts)) {
  throw new Error('fast-dev build mutated native runtime artifacts.');
}
const fullMillis = await checkProfile('full');

console.log(
  `native profiles ok: fast=${fastDependencies.size} packages/${fastMillis}ms full=${fullDependencies.size} packages/${fullMillis}ms`,
);
