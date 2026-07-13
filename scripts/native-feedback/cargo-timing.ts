import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';

interface CargoTimingUnit {
  i: number;
  duration: number;
  unblocked_units: number[];
  sections: Array<[string, { start: number; end: number }]> | null;
}

const timingUnits = (html: string): CargoTimingUnit[] => {
  const match = html.match(/const UNIT_DATA = (\[[\s\S]*?\n\]);/u);
  if (match?.[1] === undefined) throw new Error('Cargo timing report omitted UNIT_DATA.');
  return JSON.parse(match[1]) as CargoTimingUnit[];
};

export function parseCargoTimingReport(html: string) {
  const units = timingUnits(html);
  const byId = new Map(units.map((unit) => [unit.i, unit]));
  const memo = new Map<number, number>();
  const visiting = new Set<number>();
  const pathMs = (id: number): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) throw new Error('Cargo timing report contains a dependency cycle.');
    visiting.add(id);
    const unit = byId.get(id);
    if (unit === undefined) return 0;
    const downstream = unit.unblocked_units.map(pathMs);
    const result = unit.duration * 1_000 + Math.max(0, ...downstream);
    visiting.delete(id);
    memo.set(id, result);
    return result;
  };
  const dirtyMatch = html.match(/<td>Dirty units:<\/td><td>(\d+)<\/td>/u);
  if (dirtyMatch?.[1] === undefined) throw new Error('Cargo timing report omitted dirty-unit count.');
  const linkMs = units.reduce(
    (total, unit) =>
      total +
      (unit.sections ?? [])
        .filter(([name]) => name === 'link')
        .reduce((subtotal, [, section]) => subtotal + (section.end - section.start) * 1_000, 0),
    0,
  );
  return {
    rebuiltCrates: Number(dirtyMatch[1]),
    criticalPathMs: Math.round(Math.max(0, ...units.map(({ i }) => pathMs(i))) * 1_000) / 1_000,
    linkMs: Math.round(linkMs * 1_000) / 1_000,
    timingReportDigest: createHash('sha256').update(html).digest('hex'),
  };
}

export async function cargoArtifactBytes(output: string): Promise<number> {
  const paths = new Set<string>();
  for (const line of output.split('\n')) {
    try {
      const message = JSON.parse(line) as { reason?: string; filenames?: unknown };
      if (message.reason !== 'compiler-artifact' || !Array.isArray(message.filenames)) continue;
      for (const path of message.filenames) if (typeof path === 'string') paths.add(path);
    } catch {
      // Test stdout and rendered diagnostics may be interleaved with Cargo JSON.
    }
  }
  const sizes = await Promise.all([...paths].map(async (path) => (await stat(path).catch(() => null))?.size ?? 0));
  return sizes.reduce((total, size) => total + size, 0);
}

export function peakRssBytes(stderr: string): number {
  const match = stderr.match(/\n?\s*(\d+)\s+maximum resident set size/u);
  if (match?.[1] === undefined) throw new Error('/usr/bin/time omitted maximum resident set size.');
  return Number(match[1]);
}
