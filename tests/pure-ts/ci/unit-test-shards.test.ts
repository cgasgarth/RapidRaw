import { expect, test } from 'bun:test';
import { partitionUnitTestFiles } from '../../../scripts/ci/run-unit-test-shard';

test('unit shards are deterministic, balanced, disjoint, and exhaustive', () => {
  const files = ['z.test.ts', 'a.test.ts', 'm.test.ts', 'b.test.ts', 'q.test.ts', 'c.test.ts', 'x.test.ts'];
  const first = partitionUnitTestFiles(files, 4);
  expect(first).toEqual(partitionUnitTestFiles([...files].reverse(), 4));
  expect(first.flat().sort()).toEqual([...files].sort());
  expect(new Set(first.flat()).size).toBe(files.length);
  expect(
    Math.max(...first.map((shard) => shard.length)) - Math.min(...first.map((shard) => shard.length)),
  ).toBeLessThanOrEqual(1);
});
