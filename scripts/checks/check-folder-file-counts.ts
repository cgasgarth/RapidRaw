#!/usr/bin/env bun

import { readdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_FILES_PER_FOLDER = 10;

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.turbo',
  'artifacts',
  'dist',
  'node_modules',
  'private-artifacts',
  'private-fixtures',
  'target',
]);

type FolderAllowance = {
  issue: string;
  reason: string;
};

const ALLOWED_LARGE_FOLDERS: Record<string, FolderAllowance> = {
  '.': {
    issue: '#4227',
    reason: 'repository root keeps canonical project files until cleanup lands',
  },
  '.github/workflows': {
    issue: '#4237',
    reason: 'workflow names are branch-protection sensitive',
  },
  'packages/rawengine-schema/src': {
    issue: '#4214',
    reason: 'schema package source is pending domain grouping',
  },
  'src-tauri/icons': {
    issue: '#4230',
    reason: 'Tauri icon names may be platform/tooling required',
  },
  'src-tauri/icons/ios': {
    issue: '#4231',
    reason: 'iOS icon names may be platform/tooling required',
  },
  'src-tauri/lensfun_db': {
    issue: '#4228',
    reason: 'Lensfun database layout may be vendor/tooling required',
  },
  'src-tauri/src': {
    issue: '#4213',
    reason: 'Rust modules are pending domain grouping where practical',
  },
  'src/i18n/locales': {
    issue: '#4234',
    reason: 'locale files may intentionally stay flat by locale code',
  },
  'src/schemas': {
    issue: '#4210',
    reason: 'schemas are pending product-domain grouping',
  },
  'src/schemas/negative-lab': {
    issue: '#4290',
    reason: 'negative-lab schemas are grouped under their domain folder',
  },
  'src/utils/mask': {
    issue: '#4317',
    reason: 'mask utilities are consolidated under a dedicated domain folder',
  },
  'src/utils': {
    issue: '#4209',
    reason: 'utilities are pending owned-domain split',
  },
  'src/utils/agent/tools': {
    issue: '#4293',
    reason: 'agent apply tools are grouped under their domain folder',
  },
  'tests/integration/checks': {
    issue: '#4208',
    reason: 'integration checks are pending domain/native-runner cleanup',
  },
  'tests/integration/checks/layers': {
    issue: '#4329',
    reason: 'layer integration checks are grouped under a dedicated folder for this issue',
  },
  'tests/integration/checks/super-resolution': {
    issue: '#4325',
    reason: 'super-resolution checks are grouped under a dedicated folder for this issue',
  },
  'tests/integration/checks/ai': {
    issue: '#4295',
    reason: 'AI checks are being reorganized into a dedicated subfolder.',
  },
  'tests/integration/checks/panorama': {
    issue: '#4324',
    reason: 'Panorama checks are being grouped into a dedicated folder as part of this issue.',
  },
  'tests/integration/checks/agent': {
    issue: '#4313',
    reason: 'Agent checks are grouped under a dedicated folder for this issue.',
  },
  'tests/integration/checks/hdr': {
    issue: '#4323',
    reason: 'HDR checks are reorganized into a dedicated folder for this issue.',
  },
  'tests/integration/checks/color': {
    issue: '#4297',
    reason: 'color checks are grouped for dedicated organization in this issue',
  },
  'tests/integration/checks/negative-lab': {
    issue: '#4296',
    reason: 'negative-lab checks are grouped under their domain folder',
  },
  'tests/integration/checks/focus': {
    issue: '#4328',
    reason: 'focus checks are grouped under a dedicated folder for this issue',
  },
  'tests/integration/checks/film': {
    issue: '#4330',
    reason: 'film checks are grouped under a dedicated folder for this issue',
  },
  'tests/integration/checks/export': {
    issue: '#4331',
    reason: 'export checks are grouped under a dedicated folder for this issue',
  },
};

type FolderCount = {
  count: number;
  folder: string;
};

const repoRoot = process.cwd();
const counts: FolderCount[] = [];

async function collectFolderCounts(relativeFolder: string): Promise<void> {
  const absoluteFolder = path.join(repoRoot, relativeFolder);
  const entries = await readdir(absoluteFolder, { withFileTypes: true });
  const fileCount = entries.filter((entry) => entry.isFile()).length;
  const normalizedFolder = relativeFolder === '' ? '.' : relativeFolder;

  if (fileCount > MAX_FILES_PER_FOLDER) {
    counts.push({ count: fileCount, folder: normalizedFolder });
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const childFolder = relativeFolder === '' ? entry.name : `${relativeFolder}/${entry.name}`;
    if (childFolder === 'src-tauri/target') {
      continue;
    }

    await collectFolderCounts(childFolder);
  }
}

await collectFolderCounts('');

const oversizedWithoutAllowance = counts
  .filter(({ folder }) => ALLOWED_LARGE_FOLDERS[folder] === undefined)
  .sort((left, right) => right.count - left.count || left.folder.localeCompare(right.folder));

const staleAllowances = Object.keys(ALLOWED_LARGE_FOLDERS)
  .filter((folder) => counts.every((count) => count.folder !== folder))
  .sort();

if (oversizedWithoutAllowance.length === 0 && staleAllowances.length === 0) {
  console.log('folder-count ok');
  process.exit(0);
}

if (oversizedWithoutAllowance.length > 0) {
  console.error(`Folders with more than ${MAX_FILES_PER_FOLDER} files need cleanup issue or allowlist:`);
  for (const { count, folder } of oversizedWithoutAllowance.slice(0, 20)) {
    console.error(`- ${folder}: ${count} files`);
  }
}

if (staleAllowances.length > 0) {
  console.error('Remove stale folder-count allowlist entries:');
  for (const folder of staleAllowances.slice(0, 20)) {
    const allowance = ALLOWED_LARGE_FOLDERS[folder];
    console.error(`- ${folder}: ${allowance.issue} ${allowance.reason}`);
  }
}

process.exit(1);
