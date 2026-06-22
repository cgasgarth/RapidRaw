import { basename, extname, join, relative } from 'node:path';

export type RepoFile = {
  absolutePath: string;
  entry: string;
  repoPath: string;
};

export type WalkRepoFilesOptions = {
  include: (file: RepoFile) => boolean;
  root?: string;
  startDir?: string;
};

export const DEFAULT_IGNORED_DIRS = new Set(['.git', 'dist', 'node_modules', 'src-tauri/target', 'target']);

export const getExtension = (path: string): string => extname(path);

export const toRepoPath = (root: string, absolutePath: string): string =>
  relative(root, absolutePath).split('/').join('/');

export const isIgnoredRepoPath = (repoPath: string, ignoredDirs = DEFAULT_IGNORED_DIRS): boolean =>
  [...ignoredDirs].some((ignored) => repoPath === ignored || repoPath.startsWith(`${ignored}/`));

export const walkRepoFiles = ({ include, root = process.cwd(), startDir = root }: WalkRepoFilesOptions): string[] => {
  const files: string[] = [];
  const glob = new Bun.Glob('**/*');

  for (const scannedPath of glob.scanSync({ cwd: startDir, dot: true, onlyFiles: true })) {
    const absolutePath = join(startDir, scannedPath);
    const repoPath = toRepoPath(root, absolutePath);
    if (isIgnoredRepoPath(repoPath)) continue;

    const entry = basename(repoPath);
    if (include({ absolutePath, entry, repoPath })) files.push(absolutePath);
  }

  return files;
};
