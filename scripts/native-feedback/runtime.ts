import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { NativeFeedbackExecutor } from './benchmark';
import { cargoArtifactBytes, parseCargoTimingReport, peakRssBytes } from './cargo-timing';
import { createNativeFeedbackRunGuard } from './run-guard';

export function selectNativeFeedbackCargoArguments(options: {
  scenario: 'clean' | 'noop' | 'leaf-edit' | 'core-edit';
  cargoArguments: readonly string[];
  cleanCargoArguments?: readonly string[];
  cleanPreparationCargoArguments?: readonly string[];
  focusedCargoArguments?: readonly string[];
}): readonly string[] {
  if (options.scenario === 'clean' && options.cleanCargoArguments !== undefined) return options.cleanCargoArguments;
  if ((options.scenario === 'noop' || options.scenario === 'leaf-edit') && options.focusedCargoArguments !== undefined)
    return options.focusedCargoArguments;
  return options.cargoArguments;
}

export async function createCargoNativeFeedbackExecutor(options: {
  workspaceRoot: string;
  targetDir: string;
  leafPath: string;
  corePath: string;
  cargoArguments: readonly string[];
  cleanCargoArguments?: readonly string[];
  focusedCargoArguments?: readonly string[];
  signal?: AbortSignal;
}): Promise<{
  executor: NativeFeedbackExecutor;
  invalidate: () => Promise<void>;
  invalidateSync: () => void;
  restore: () => Promise<void>;
  restoreSync: () => void;
}> {
  const targetDir = resolve(options.targetDir);
  const workspaceRoot = resolve(options.workspaceRoot);
  const guard = await createNativeFeedbackRunGuard({
    targetDir,
    sourcePaths: [options.leafPath, options.corePath].map((path) => resolve(workspaceRoot, path)),
  });
  return {
    executor: {
      async run({ scenario, iteration, profile }) {
        console.log(`native-feedback start profile=${profile.id} scenario=${scenario} iteration=${iteration}`);
        if (scenario === 'clean') await rm(targetDir, { force: true, recursive: true });
        if (scenario === 'leaf-edit') await guard.mutate(resolve(workspaceRoot, options.leafPath), scenario, iteration);
        if (scenario === 'core-edit') await guard.mutate(resolve(workspaceRoot, options.corePath), scenario, iteration);
        const cargoArguments = selectNativeFeedbackCargoArguments({
          scenario,
          cargoArguments: options.cargoArguments,
          cleanCargoArguments: options.cleanCargoArguments,
          focusedCargoArguments: options.focusedCargoArguments,
        });
        const runCargo = async (arguments_: readonly string[]) => {
          const command = [
            'cargo',
            ...arguments_,
            '--profile',
            profile.cargoProfile,
            '--locked',
            '--timings',
            '--message-format',
            'json-render-diagnostics',
            '--target-dir',
            targetDir,
          ];
          const started = performance.now();
          const process = Bun.spawn(['/usr/bin/time', '-l', ...command], {
            cwd: resolve(workspaceRoot, 'src-tauri'),
            env: {
              ...Bun.env,
              RUSTFLAGS: profile.rustFlags.join(' '),
            },
            signal: options.signal,
            stderr: 'pipe',
            stdout: 'pipe',
          });
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(process.stdout).text(),
            new Response(process.stderr).text(),
            process.exited,
          ]);
          const wallMs = performance.now() - started;
          if (exitCode !== 0)
            throw new Error(
              `Native feedback command failed (${exitCode}): ${command.join(' ')}\n${stderr.slice(-4_000)}`,
            );
          const timingHtml = await readFile(resolve(targetDir, 'cargo-timings/cargo-timing.html'), 'utf8');
          return {
            artifactBytes: await cargoArtifactBytes(stdout),
            command,
            peakRssBytes: peakRssBytes(stderr),
            timing: parseCargoTimingReport(timingHtml),
            wallMs,
          };
        };
        const runs = [await runCargo(cargoArguments)];
        if (scenario === 'clean' && options.cleanPreparationCargoArguments !== undefined)
          runs.push(await runCargo(options.cleanPreparationCargoArguments));
        const wallMs = runs.reduce((total, run) => total + run.wallMs, 0);
        const command = runs.flatMap((run, index) => (index === 0 ? run.command : ['&&', ...run.command]));
        const timingReportDigest = createHash('sha256')
          .update(runs.map(({ timing }) => timing.timingReportDigest).join(':'))
          .digest('hex');
        const sample = {
          scenario,
          iteration,
          wallMs,
          criticalPathMs: runs.reduce((total, run) => total + run.timing.criticalPathMs, 0),
          rebuiltCrates: runs.reduce((total, run) => total + run.timing.rebuiltCrates, 0),
          linkMs: runs.reduce((total, run) => total + run.timing.linkMs, 0),
          peakRssBytes: Math.max(...runs.map((run) => run.peakRssBytes)),
          artifactBytes: Math.max(...runs.map((run) => run.artifactBytes)),
          timeToTestMs: wallMs,
          status: 'valid',
          measurement: {
            kind: 'cargo-runtime',
            command,
            timingReportDigest,
            exitCode: 0,
          },
        };
        console.log(
          `native-feedback done profile=${profile.id} scenario=${scenario} iteration=${iteration} wallMs=${Math.round(wallMs)} rebuilt=${sample.rebuiltCrates}`,
        );
        return sample;
      },
    },
    invalidate: guard.invalidateTarget,
    invalidateSync: guard.invalidateTargetSync,
    restore: guard.restoreSources,
    restoreSync: guard.restoreSourcesSync,
  };
}
