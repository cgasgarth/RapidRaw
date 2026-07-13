import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface NativeFeedbackRunGuard {
  invalidateTarget: () => Promise<void>;
  invalidateTargetSync: () => void;
  mutate: (path: string, scenario: 'leaf-edit' | 'core-edit', iteration: number) => Promise<void>;
  restoreSources: () => Promise<void>;
  restoreSourcesSync: () => void;
}

export async function createNativeFeedbackRunGuard(options: {
  targetDir: string;
  sourcePaths: readonly string[];
}): Promise<NativeFeedbackRunGuard> {
  const targetDir = resolve(options.targetDir);
  const sources = new Map(
    await Promise.all(
      [...new Set(options.sourcePaths)].map(async (path) => {
        const absolute = resolve(path);
        return [absolute, await readFile(absolute, 'utf8')] as const;
      }),
    ),
  );
  const activeMarkers = new Map<string, Map<string, string>>();
  return {
    invalidateTarget: async () => {
      const quarantine = `${targetDir}.interrupted-${crypto.randomUUID()}`;
      try {
        await rename(targetDir, quarantine);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        return;
      }
      await rm(quarantine, { force: true, recursive: true });
    },
    invalidateTargetSync: () => {
      const quarantine = `${targetDir}.interrupted-${crypto.randomUUID()}`;
      try {
        renameSync(targetDir, quarantine);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
        throw error;
      }
      rmSync(quarantine, { force: true, recursive: true });
    },
    mutate: async (path, scenario, iteration) => {
      const absolute = resolve(path);
      const original = sources.get(absolute);
      if (original === undefined) throw new Error(`Native feedback mutation escaped declared paths: ${absolute}`);
      const markers = activeMarkers.get(absolute) ?? new Map<string, string>();
      const comment = absolute.endsWith('.toml') ? '#' : '//';
      markers.set(scenario, `\n${comment} native-feedback ${scenario} ${iteration}\n`);
      activeMarkers.set(absolute, markers);
      await writeFile(absolute, `${original}${[...markers.values()].join('')}`);
    },
    restoreSources: async () => {
      await Promise.all([...sources].map(([path, contents]) => writeFile(path, contents)));
    },
    restoreSourcesSync: () => {
      for (const [path, contents] of sources) writeFileSync(path, contents);
    },
  };
}
