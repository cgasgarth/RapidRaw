import { describe, expect, test } from 'bun:test';
import {
  catalogIndexingSnapshotSchema,
  isCurrentCatalogIndexingAuthority,
  reduceCatalogIndexingSnapshot,
  shouldAcceptCatalogIndexingAuthority,
} from '../../../src/schemas/catalogIndexingSchemas';

const running = (generation: number, operationId: number, current = 0) =>
  catalogIndexingSnapshotSchema.parse({
    authority: { generation, operationId },
    current,
    folderPath: '/catalog',
    terminalStatus: null,
    total: 2,
  });

describe('catalog indexing authority', () => {
  test('admits starts and progress monotonically', () => {
    const current = { generation: 7, operationId: 12 };

    expect(shouldAcceptCatalogIndexingAuthority({ generation: 6, operationId: 99 }, current)).toBeFalse();
    expect(shouldAcceptCatalogIndexingAuthority({ generation: 7, operationId: 11 }, current)).toBeFalse();
    expect(shouldAcceptCatalogIndexingAuthority(current, current)).toBeTrue();
    expect(shouldAcceptCatalogIndexingAuthority({ generation: 8, operationId: 1 }, current)).toBeTrue();
    expect(isCurrentCatalogIndexingAuthority(current, current)).toBeTrue();
  });

  test('stale terminal cannot clear a successor', () => {
    const successor = reduceCatalogIndexingSnapshot(
      { authority: null, isIndexing: false, progress: { current: 0, total: 0 } },
      running(2, 2, 1),
    );
    const staleTerminal = catalogIndexingSnapshotSchema.parse({
      ...running(1, 1, 2),
      terminalStatus: 'cancelled',
    });

    expect(reduceCatalogIndexingSnapshot(successor, staleTerminal)).toEqual(successor);
  });

  test('exact terminal clears only the active operation and unkeyed payloads fail closed', () => {
    const active = reduceCatalogIndexingSnapshot(
      { authority: null, isIndexing: false, progress: { current: 0, total: 0 } },
      running(3, 4, 2),
    );
    const terminal = catalogIndexingSnapshotSchema.parse({
      ...running(3, 4, 2),
      terminalStatus: 'completed',
    });

    expect(reduceCatalogIndexingSnapshot(active, terminal)).toEqual({
      authority: null,
      isIndexing: false,
      progress: { current: 0, total: 0 },
    });
    expect(() => catalogIndexingSnapshotSchema.parse({ current: 1, total: 2 })).toThrow();
  });
});
