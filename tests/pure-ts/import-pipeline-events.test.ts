import { describe, expect, test } from 'bun:test';
import {
  parseImportProgressPayload,
  parseImportStartPayload,
  parseImportTerminalPayload,
} from '../../src/schemas/tauriEventSchemas';
import { createBrowserHarnessImportLifecycle } from '../../src/validation/browserHarnessImportEvents';

describe('import pipeline event contracts', () => {
  test('accepts staged byte progress and incremental catalog publication', () => {
    const payload = parseImportProgressPayload({
      jobId: 'import-123',
      generation: 4,
      stage: 'cataloging',
      current: 2,
      total: 10,
      path: '/source/two.ARW',
      committed: 2,
      failed: 0,
      cancelled: 0,
      bytesCopied: 12_000_000,
      totalBytes: 60_000_000,
      committedPath: '/library/two.ARW',
    });

    expect(payload.stage).toBe('cataloging');
    expect(payload.committedPath).toBe('/library/two.ARW');
    expect(payload.bytesCopied).toBe(12_000_000);
  });

  test('requires exact job authority on starts and progress', () => {
    expect(parseImportStartPayload({ jobId: 'import-123', generation: 4, total: 2 })).toEqual({
      jobId: 'import-123',
      generation: 4,
      total: 2,
    });
    expect(() => parseImportStartPayload({ total: 2 })).toThrow();
    expect(() => parseImportProgressPayload({ current: 1, total: 2, path: 'one.ARW' })).toThrow();
  });

  test('browser harness lifecycle matches authoritative production events and receipt totals', () => {
    const sourcePaths = Array.from({ length: 6 }, (_, index) => `/source/import-${String(index + 1)}.ARW`);
    const lifecycle = createBrowserHarnessImportLifecycle({
      destinationFolder: '/library',
      generation: 3,
      jobId: 'browser-import',
      sourcePaths,
    });

    expect(parseImportStartPayload(lifecycle.start)).toEqual({ generation: 3, jobId: 'browser-import', total: 6 });
    expect(lifecycle.progress).toHaveLength(6);
    expect(lifecycle.progress.at(-1)).toMatchObject({
      bytesCopied: 144_000_000,
      committed: 6,
      current: 6,
      generation: 3,
      jobId: 'browser-import',
      total: 6,
      totalBytes: 144_000_000,
    });
    const terminal = parseImportTerminalPayload(lifecycle.terminal);
    expect(terminal.receipt.completed).toHaveLength(6);
    expect(terminal.receipt.totalBytes).toBe(144_000_000);
    expect(terminal.receipt.terminalStage).toBe('completed');
  });
});
