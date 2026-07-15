import { describe, expect, test } from 'bun:test';
import {
  parseImportErrorPayload,
  parseImportProgressPayload,
  parseImportStartPayload,
  parseImportTerminalPayload,
} from '../../../src/schemas/tauriEventSchemas';
import { isCurrentImportAuthority, shouldAcceptImportStart } from '../../../src/utils/importEventAuthority';
import { createBrowserHarnessImportLifecycle } from '../../../src/validation/browserHarnessImportEvents';

const terminalEvent = (generation: number, jobId: string) =>
  createBrowserHarnessImportLifecycle({
    destinationFolder: '/library',
    generation,
    jobId,
    sourcePaths: ['/source/a.raw'],
  }).terminal;

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
    const oldTerminal = parseImportTerminalPayload(terminalEvent(1, 'import-a'));
    const oldError = parseImportErrorPayload({
      generation: 1,
      jobId: 'import-a',
      message: 'old failure',
    });

    expect(isCurrentImportAuthority(oldProgress, current)).toBeFalse();
    expect(isCurrentImportAuthority(oldTerminal, current)).toBeFalse();
    expect(isCurrentImportAuthority(oldError, current)).toBeFalse();
    expect(isCurrentImportAuthority(parseImportTerminalPayload(terminalEvent(2, 'import-b')), current)).toBeTrue();
  });

  test('generation one events cannot target resumed generation two of the same job', () => {
    const current = { generation: 2, jobId: 'import-a' };

    expect(isCurrentImportAuthority(parseImportTerminalPayload(terminalEvent(1, 'import-a')), current)).toBeFalse();
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

    const terminalBeforeInvokeResponse = parseImportTerminalPayload(terminalEvent(2, 'import-a'));
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
