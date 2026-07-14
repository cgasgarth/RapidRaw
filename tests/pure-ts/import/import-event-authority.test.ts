import { describe, expect, test } from 'bun:test';
import {
  parseImportErrorPayload,
  parseImportProgressPayload,
  parseImportStartPayload,
  parseImportTerminalPayload,
} from '../../../src/schemas/tauriEventSchemas';
import { isCurrentImportAuthority, shouldAcceptImportStart } from '../../../src/utils/importEventAuthority';

describe('import event authority', () => {
  test('out-of-order predecessor events cannot target successor job B', () => {
    const current = { generation: 2, jobId: 'import-b' };
    const oldProgress = parseImportProgressPayload({
      current: 1,
      generation: 1,
      jobId: 'import-a',
      path: '/old/a.raw',
      total: 4,
    });
    const oldTerminal = parseImportTerminalPayload({
      generation: 1,
      jobId: 'import-a',
      receipt: {},
    });
    const oldError = parseImportErrorPayload({
      generation: 1,
      jobId: 'import-a',
      message: 'old failure',
    });

    expect(isCurrentImportAuthority(oldProgress, current)).toBeFalse();
    expect(isCurrentImportAuthority(oldTerminal, current)).toBeFalse();
    expect(isCurrentImportAuthority(oldError, current)).toBeFalse();
    expect(
      isCurrentImportAuthority(parseImportTerminalPayload({ generation: 2, jobId: 'import-b', receipt: {} }), current),
    ).toBeTrue();
  });

  test('generation one events cannot target resumed generation two of the same job', () => {
    const current = { generation: 2, jobId: 'import-a' };

    expect(
      isCurrentImportAuthority(parseImportTerminalPayload({ generation: 1, jobId: 'import-a', receipt: {} }), current),
    ).toBeFalse();
    expect(
      isCurrentImportAuthority(
        parseImportErrorPayload({ generation: 2, jobId: 'import-a', message: 'current failure' }),
        current,
      ),
    ).toBeTrue();
  });

  test('unkeyed progress and terminal events are rejected at the schema boundary', () => {
    expect(() => parseImportProgressPayload({ current: 1, path: '', total: 2 })).toThrow();
    expect(() => parseImportTerminalPayload({ receipt: {} })).toThrow();
  });

  test('resume start authority admits a fast terminal event before the invoke response', () => {
    let current = { generation: 1, jobId: 'import-a' };
    const resumeStart = parseImportStartPayload({ generation: 2, jobId: 'import-a', total: 4 });
    expect(shouldAcceptImportStart(resumeStart, current)).toBeTrue();
    current = { generation: resumeStart.generation, jobId: resumeStart.jobId };

    const terminalBeforeInvokeResponse = parseImportTerminalPayload({
      generation: 2,
      jobId: 'import-a',
      receipt: {},
    });
    expect(isCurrentImportAuthority(terminalBeforeInvokeResponse, current)).toBeTrue();
  });

  test('a delayed predecessor start cannot roll back a newer active authority', () => {
    const current = { generation: 2, jobId: 'import-b' };

    expect(
      shouldAcceptImportStart(parseImportStartPayload({ generation: 1, jobId: 'import-a', total: 4 }), current),
    ).toBeFalse();
    expect(
      shouldAcceptImportStart(parseImportStartPayload({ generation: 2, jobId: 'import-a', total: 4 }), current),
    ).toBeFalse();
    expect(
      shouldAcceptImportStart(parseImportStartPayload({ generation: 3, jobId: 'import-c', total: 4 }), current),
    ).toBeTrue();
  });
});
