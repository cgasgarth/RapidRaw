import { describe, expect, mock, test } from 'bun:test';
import { DEFAULT_FOCUS_STACK_UI_SETTINGS } from '../../../src/schemas/focus-stack/focusStackUiSchemas';
import { buildFocusStackDerivedOutputReceipt } from '../../../src/utils/derivedOutputReceipt';
import { registerCurrentDerivedOutputReceipt } from '../../../src/utils/derivedOutputReceiptRegistration';
import { buildFocusStackOutputReviewWorkflow } from '../../../src/utils/focusStackOutputReview';

const buildReceipt = () =>
  buildFocusStackDerivedOutputReceipt({
    review: buildFocusStackOutputReviewWorkflow({
      artifactPath: '/outputs/focus-stack.tif',
      settings: DEFAULT_FOCUS_STACK_UI_SETTINGS,
      sourceCount: 2,
      sourcePaths: ['/sources/a.ARW', '/sources/b.ARW'],
    }),
    settings: DEFAULT_FOCUS_STACK_UI_SETTINGS,
  });

describe('derived output receipt completion registration', () => {
  test('builder and stable receipt identity are deterministic', () => {
    expect(buildReceipt()).toEqual(buildReceipt());
    expect(buildReceipt().receiptId).toBe(buildReceipt().receiptId);
  });

  test('registers a current completion before the caller exposes its output', () => {
    const order: string[] = [];
    const receipt = registerCurrentDerivedOutputReceipt({
      build: buildReceipt,
      isCurrent: () => true,
      upsert: () => order.push('receipt'),
    });
    order.push('output');

    expect(receipt?.receiptId).toBe(buildReceipt().receiptId);
    expect(order).toEqual(['receipt', 'output']);
  });

  test('rejects stale completion both before and after receipt construction', () => {
    const build = mock(buildReceipt);
    const upsert = mock(() => {});
    expect(registerCurrentDerivedOutputReceipt({ build, isCurrent: () => false, upsert })).toBeNull();
    expect(build).not.toHaveBeenCalled();

    let currentCheck = 0;
    expect(
      registerCurrentDerivedOutputReceipt({
        build,
        isCurrent: () => currentCheck++ === 0,
        upsert,
      }),
    ).toBeNull();
    expect(build).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  test('duplicate completion and reopen converge on one stable record', () => {
    const records = new Map<string, ReturnType<typeof buildReceipt>>();
    const upsert = (receipt: ReturnType<typeof buildReceipt>) => records.set(receipt.receiptId, receipt);
    registerCurrentDerivedOutputReceipt({ build: buildReceipt, isCurrent: () => true, upsert });
    registerCurrentDerivedOutputReceipt({ build: buildReceipt, isCurrent: () => true, upsert });
    expect(records.size).toBe(1);
  });

  test('registration failure is reported without hiding or rerunning the completed output', () => {
    const operation = mock(() => '/outputs/focus-stack.tif');
    const outputPath = operation();
    const onRegistrationError = mock(() => {});
    const receipt = registerCurrentDerivedOutputReceipt({
      build: buildReceipt,
      isCurrent: () => true,
      onRegistrationError,
      upsert: () => {
        throw new Error('store unavailable');
      },
    });

    expect(receipt).toBeNull();
    expect(onRegistrationError).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(outputPath).toBe('/outputs/focus-stack.tif');
  });
});
