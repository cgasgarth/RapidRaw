import { describe, expect, test } from 'bun:test';
import { parseImportProgressPayload, parseImportStartPayload } from '../../src/schemas/tauriEventSchemas';

describe('import pipeline event contracts', () => {
  test('accepts staged byte progress and incremental catalog publication', () => {
    const payload = parseImportProgressPayload({
      jobId: 'import-123',
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

  test('retains compatibility with legacy progress and optional job ids', () => {
    expect(parseImportStartPayload({ total: 2 })).toEqual({ total: 2 });
    expect(parseImportProgressPayload({ current: 1, total: 2, path: 'one.ARW' }).path).toBe('one.ARW');
  });
});
