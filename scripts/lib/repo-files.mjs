// @ts-check

import { readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

export const DEFAULT_IGNORED_DIRS = new Set(['.git', 'dist', 'node_modules', 'src-tauri/target', 'target']);

export const getExtension = (path) => extname(path);

export const toRepoPath = (root, absolutePath) => relative(root, absolutePath).split('/').join('/');

export const isIgnoredRepoPath = (repoPath, ignoredDirs = DEFAULT_IGNORED_DIRS) =>
  [...ignoredDirs].some((ignored) => repoPath === ignored || repoPath.startsWith(`${ignored}/`));

export const walkRepoFiles = ({ include, root = process.cwd(), startDir = root }) => {
  const files = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const absolutePath = join(dir, entry);
      const repoPath = toRepoPath(root, absolutePath);
      if (isIgnoredRepoPath(repoPath)) continue;

      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (stat.isFile() && include({ absolutePath, entry, repoPath })) {
        files.push(absolutePath);
      }
    }
  };

  walk(startDir);
  return files;
};
