import { createHash } from 'node:crypto';
import { arch, cpus, loadavg, platform, release, totalmem } from 'node:os';
import type { PerformanceIdentity } from './model';

const command = (args: readonly string[]): string => {
  const result = Bun.spawnSync([...args], { stderr: 'pipe', stdout: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`Identity command failed: ${args.join(' ')}`);
  return result.stdout.toString().trim();
};

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

const optionalCommand = (args: readonly string[]): string => {
  const result = Bun.spawnSync([...args], { stderr: 'pipe', stdout: 'pipe' });
  return result.exitCode === 0 ? result.stdout.toString().trim() : 'unreported';
};

const selectedLines = (value: string, fields: readonly string[]): string =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => fields.some((field) => line.startsWith(`${field}:`)))
    .join('\n');

const hardwareDetails = () => {
  const gpuOverride = process.env.RAWENGINE_PERF_GPU_CLASS;
  const displayOverride = process.env.RAWENGINE_PERF_DISPLAY_CLASS;
  const storageOverride = process.env.RAWENGINE_PERF_STORAGE_CLASS;
  if (platform() !== 'darwin')
    return {
      display: displayOverride ?? 'unreported',
      gpu: gpuOverride ?? 'unreported',
      storage: storageOverride ?? 'unreported',
    };
  const displays = optionalCommand(['system_profiler', 'SPDisplaysDataType', '-detailLevel', 'mini']);
  const selectedGpu = selectedLines(displays, [
    'Bus',
    'Chipset Model',
    'Metal Support',
    'Total Number of Cores',
    'Type',
    'Vendor',
  ]);
  const selectedDisplays = selectedLines(displays, ['Connection Type', 'Display Type', 'Resolution']);
  const storage = optionalCommand(['/usr/sbin/diskutil', 'info', '/']);
  return {
    display: displayOverride ?? (selectedDisplays || 'unreported'),
    gpu: gpuOverride ?? (selectedGpu || 'unreported'),
    storage:
      storageOverride ??
      (selectedLines(storage, ['Device Location', 'Disk Size', 'File System Personality', 'Protocol', 'Solid State']) ||
        'unreported'),
  };
};

const powerSource = (): string => {
  const override = process.env.RAWENGINE_PERF_POWER_SOURCE;
  if (override) return override;
  if (platform() !== 'darwin') return 'unreported';
  return (
    optionalCommand(['pmset', '-g', 'batt'])
      .split('\n')[0]
      ?.replace(/^Now drawing from /u, '') || 'unreported'
  );
};

export function capturePerformanceIdentity(profile = 'development'): PerformanceIdentity {
  const cpu = cpus();
  const memoryGiB = Math.max(1, Math.round(totalmem() / 1024 ** 3));
  const details = hardwareDetails();
  const displayClassHash = digest(details.display);
  const gpuClassHash = digest(details.gpu);
  const storageClassHash = digest(details.storage);
  const hardwareClass = JSON.stringify({
    arch: arch(),
    cpuCores: cpu.length,
    cpuModel: cpu[0]?.model.trim().replaceAll(/\s+/gu, ' ') ?? 'unknown',
    memoryGiB,
    platform: platform(),
    displayClassHash,
    gpuClassHash,
    storageClassHash,
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
      displayClassHash,
      gpuClassHash,
      memoryGiB,
      storageClassHash,
    },
    environment: {
      arch: arch(),
      bun: Bun.version,
      loadAverage1m: Math.max(0, loadavg()[0] ?? 0),
      node: process.versions.node ?? 'unreported',
      os: `${platform()}-${release()}`,
      powerSource: powerSource(),
      rustc: optionalCommand(['rustc', '--version']),
      thermalState: process.env.RAWENGINE_PERF_THERMAL_STATE ?? 'unreported',
    },
  };
}
