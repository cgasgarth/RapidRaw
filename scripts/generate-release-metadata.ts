#!/usr/bin/env node
// @ts-check

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const RELEASE_ARTIFACT_PATTERNS = [
  /\.aab$/u,
  /\.apk$/u,
  /\.AppImage$/u,
  /\.app\.tar\.gz$/u,
  /\.deb$/u,
  /\.dmg$/u,
  /\.exe$/u,
  /\.msi$/u,
  /\.rpm$/u,
  /\.tar\.gz$/u,
  /\.zip$/u,
];

function parseArgs(args) {
  const parsed = {
    roots: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case '--output-dir':
        parsed.outputDir = args[index + 1];
        index += 1;
        break;
      case '--prefix':
        parsed.prefix = args[index + 1];
        index += 1;
        break;
      case '--root':
        parsed.roots.push(args[index + 1]);
        index += 1;
        break;
      case '--self-test':
        parsed.selfTest = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function isReleaseArtifact(filePath) {
  return RELEASE_ARTIFACT_PATTERNS.some((pattern) => pattern.test(filePath));
}

async function collectReleaseArtifacts(root, cwd) {
  const files = [];

  async function visit(currentPath) {
    let entryStat;

    try {
      entryStat = await stat(currentPath);
    } catch {
      return;
    }

    if (entryStat.isDirectory()) {
      const entries = await readdir(currentPath);

      for (const entry of entries) {
        await visit(path.join(currentPath, entry));
      }

      return;
    }

    if (!entryStat.isFile() || !isReleaseArtifact(currentPath)) {
      return;
    }

    files.push(path.relative(cwd, currentPath).split(path.sep).join('/'));
  }

  await visit(root);
  return files;
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

export async function generateReleaseMetadata({ outputDir, prefix, roots, cwd = process.cwd() }) {
  if (!outputDir) {
    throw new Error('Missing required --output-dir value.');
  }

  if (!prefix) {
    throw new Error('Missing required --prefix value.');
  }

  if (roots.length === 0) {
    throw new Error('At least one --root value is required.');
  }

  mkdirSync(outputDir, { recursive: true });

  const artifactPaths = (await Promise.all(roots.map((root) => collectReleaseArtifacts(path.resolve(cwd, root), cwd))))
    .flat()
    .sort((left, right) => left.localeCompare(right));

  const files = artifactPaths.map((artifactPath) => ({
    path: artifactPath,
    sha256: sha256File(path.resolve(cwd, artifactPath)),
  }));

  const checksumManifest = files.map((file) => `${file.sha256}  ${file.path}`).join('\n');
  const checksumPath = path.join(outputDir, `${prefix}_checksums.sha256`);
  const summaryPath = path.join(outputDir, `${prefix}_release-metadata.json`);

  writeFileSync(
    checksumPath,
    checksumManifest.length > 0 ? `${checksumManifest}\n` : '# No release artifacts matched checksum patterns.\n',
  );
  writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        prefix,
        artifactCount: files.length,
        files,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`Generated ${checksumPath}`);
  console.log(`Generated ${summaryPath}`);
  console.log(`Matched ${files.length} release artifact(s).`);

  return {
    checksumPath,
    summaryPath,
    files,
  };
}

async function runSelfTest() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'rapidraw-release-metadata-'));

  try {
    const outputDir = path.join(fixtureRoot, 'metadata');
    const artifactDir = path.join(fixtureRoot, 'artifacts');
    mkdirSync(artifactDir, { recursive: true });

    const artifactPath = path.join(artifactDir, 'RawEngine.dmg');
    const ignoredPath = path.join(artifactDir, 'ignored.txt');
    writeFileSync(artifactPath, 'release artifact');
    writeFileSync(ignoredPath, 'not a release artifact');

    const result = await generateReleaseMetadata({
      outputDir,
      prefix: 'test',
      roots: ['artifacts'],
      cwd: fixtureRoot,
    });

    if (result.files.length !== 1 || result.files[0].path !== 'artifacts/RawEngine.dmg') {
      throw new Error(`Expected one DMG artifact, got ${JSON.stringify(result.files)}`);
    }

    const manifest = readFileSync(result.checksumPath, 'utf8');
    if (!manifest.includes('artifacts/RawEngine.dmg') || manifest.includes('ignored.txt')) {
      throw new Error(`Unexpected checksum manifest content: ${manifest}`);
    }

    console.log('generate-release-metadata self-test passed');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));

if (args.selfTest) {
  await runSelfTest();
} else {
  await generateReleaseMetadata(args);
}
