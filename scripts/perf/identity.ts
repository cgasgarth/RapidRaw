import { createHash } from 'node:crypto';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import type { PerformanceIdentity } from './model';

const command = (args: readonly string[]): string => {
  const result = Bun.spawnSync([...args], { stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`Identity command failed: ${args.join(' ')}`);
  return result.stdout.toString().trim();
};

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

export function capturePerformanceIdentity(profile = 'development'): PerformanceIdentity {
  const cpu = cpus();
  const memoryGiB = Math.max(1, Math.round(totalmem() / 1024 ** 3));
  const hardwareClass = JSON.stringify({
    arch: arch(),
    cpuCores: cpu.length,
    cpuModel: cpu[0]?.model.trim().replaceAll(/\s+/gu, ' ') ?? 'unknown',
    memoryGiB,
    platform: platform(),
  });
  return {
    git: {
      commit: command(['git', 'rev-parse', 'HEAD']),
      dirtyDigest: digest(command(['git', 'status', '--porcelain=v1'])),
    },
    build: { profile, runtime: `bun-${Bun.version}` },
    hardware: {
      classId: digest(hardwareClass),
      cpuCores: cpu.length,
      cpuModelHash: digest(cpu[0]?.model.trim().replaceAll(/\s+/gu, ' ') ?? 'unknown'),
      memoryGiB,
    },
    environment: { arch: arch(), bun: Bun.version, os: `${platform()}-${release()}` },
  };
}
