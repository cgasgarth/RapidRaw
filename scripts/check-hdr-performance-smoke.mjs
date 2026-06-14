const PERFORMANCE_CASES = [
  {
    command: ['bun', 'scripts/check-hdr-alignment-smoke.mjs'],
    maxRuntimeMs: 2500,
    name: 'hdr_alignment_smoke',
  },
  {
    command: ['bun', 'scripts/check-hdr-merge-weighting-smoke.mjs'],
    maxRuntimeMs: 2500,
    name: 'hdr_merge_weighting_smoke',
  },
  {
    command: ['bun', 'scripts/check-hdr-deghosting-smoke.mjs'],
    maxRuntimeMs: 2500,
    name: 'hdr_deghosting_smoke',
  },
];

const results = [];

for (const performanceCase of PERFORMANCE_CASES) {
  const startedAt = performance.now();
  const process = Bun.spawnSync(performanceCase.command, {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const runtimeMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
  const stdout = process.stdout.toString().trim();
  const stderr = process.stderr.toString().trim();

  if (process.exitCode !== 0) {
    throw new Error(`${performanceCase.name} failed with exit code ${process.exitCode}.\n${stdout}\n${stderr}`.trim());
  }

  if (runtimeMs > performanceCase.maxRuntimeMs) {
    throw new Error(`${performanceCase.name} exceeded ${performanceCase.maxRuntimeMs} ms. Observed ${runtimeMs} ms.`);
  }

  results.push({
    maxRuntimeMs: performanceCase.maxRuntimeMs,
    name: performanceCase.name,
    runtimeMs,
  });
}

console.log(
  JSON.stringify(
    {
      fixture: 'hdr_performance_smoke_v1',
      results,
      totalRuntimeMs: Math.round(results.reduce((total, result) => total + result.runtimeMs, 0) * 1000) / 1000,
    },
    null,
    2,
  ),
);
