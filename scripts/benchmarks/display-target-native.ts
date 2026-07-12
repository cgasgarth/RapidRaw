#!/usr/bin/env bun

import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';

const args = process.argv.slice(2);
const binaryIndex = args.indexOf('--binary');
if (binaryIndex < 0 || !args[binaryIndex + 1]) throw new Error('Missing --binary <RapidRAW executable>.');
const binary = resolve(args[binaryIndex + 1]);

const reportSchema = z
  .object({
    blankFramesFromDisplayEvents: z.literal(0),
    building: z.literal(false),
    coalescedEvents: z.number().int().min(999),
    colorContract: z.literal('pixels_and_jpeg_icc_from_same_snapshot'),
    computeContextResetsFromDisplayEvents: z.literal(0),
    deviceGeneration: z.number().int().nonnegative(),
    displayResourceBuilds: z.number().int().min(1).max(2),
    displayResourceGeneration: z.number().int().min(1).max(2),
    inFlightJobsCancelledFromDisplayEvents: z.literal(0),
    pending: z.literal(false),
    processId: z.number().int().positive(),
    rawEvents: z.number().int().min(1_001),
    resolutions: z.number().int().min(1).max(3),
    target: z.object({ profileSha256: z.string().min(32) }).passthrough(),
  })
  .passthrough();

const stopProcess = async (process: Bun.Subprocess): Promise<void> => {
  if (process.exitCode !== null) return;
  process.kill('SIGTERM');
  const exited = await Promise.race([process.exited.then(() => true), Bun.sleep(2_000).then(() => false)]);
  if (!exited && process.exitCode === null) {
    process.kill('SIGKILL');
    await process.exited;
  }
};

const main = async (): Promise<void> => {
  await access(binary);
  const root = await mkdtemp(join(tmpdir(), 'rawengine-display-target-benchmark-'));
  const reportPath = join(root, 'report.json');
  await mkdir(join(root, 'home'), { recursive: true });
  const child = Bun.spawn([binary], {
    env: {
      ...process.env,
      HOME: join(root, 'home'),
      RAWENGINE_DISPLAY_TARGET_BENCHMARK_REPORT: reportPath,
      RUST_LOG: 'warn',
    },
    stderr: 'pipe',
    stdout: 'ignore',
  });
  try {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      try {
        const report = reportSchema.parse(JSON.parse(await readFile(reportPath, 'utf8')));
        if (report.processId !== child.pid) {
          throw new Error(`report PID ${report.processId} did not match launched child PID ${child.pid}`);
        }
        console.log(
          `native display target benchmark ok: ${JSON.stringify({
            builds: report.displayResourceBuilds,
            coalesced: report.coalescedEvents,
            generation: report.displayResourceGeneration,
            rawEvents: report.rawEvents,
            resolutions: report.resolutions,
          })}`,
        );
        return;
      } catch (error) {
        if (child.exitCode !== null) {
          const stderr = child.stderr instanceof ReadableStream ? await new Response(child.stderr).text() : '';
          throw new Error(
            `RapidRAW exited before ${basename(reportPath)} (${child.exitCode}): ${stderr.slice(-2_000)}`,
            {
              cause: error,
            },
          );
        }
        await Bun.sleep(25);
      }
    }
    throw new Error('Timed out waiting for native display target benchmark report.');
  } finally {
    await stopProcess(child);
    await rm(root, { force: true, recursive: true });
  }
};

void main().catch((error: unknown) => {
  console.error('native display target benchmark failed');
  console.error(error);
  process.exitCode = 1;
});
