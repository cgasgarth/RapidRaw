#!/usr/bin/env bun

export const partitionUnitTestFiles = (files: readonly string[], total: number): string[][] => {
  if (!Number.isInteger(total) || total < 1) throw new Error('unit shard total must be a positive integer');
  const shards = Array.from({ length: total }, () => [] as string[]);
  for (const [index, file] of [...new Set(files)].sort().entries()) shards[index % total].push(file);
  return shards;
};

if (import.meta.main) {
  const shard = Number(process.argv[2]);
  const total = Number(process.argv[3]);
  if (!Number.isInteger(shard) || shard < 1 || shard > total) {
    throw new Error('usage: run-unit-test-shard.ts <one-based-shard> <total>');
  }
  const files = [...new Bun.Glob('tests/pure-ts/**/*.{test,spec}.{ts,tsx}').scanSync('.')];
  const selected = partitionUnitTestFiles(files, total)[shard - 1];
  if (selected.length === 0) throw new Error(`unit shard ${shard}/${total} is empty`);
  console.log(`unit shard ${shard}/${total} (${selected.length} files)`);
  for (const file of selected) {
    const child = Bun.spawn(['bun', 'test', '--reporter=dot', file], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) {
      console.error(`unit shard ${shard}/${total} failed: ${file}`);
      process.stdout.write(stdout);
      process.stderr.write(stderr);
      process.exit(exitCode);
    }
  }
  console.log(`unit shard ${shard}/${total} ok (${selected.length} files)`);
}
