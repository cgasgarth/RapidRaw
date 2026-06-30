import { expect, test } from 'bun:test';

import { debounce, throttle } from '../../../src/utils/timing.ts';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('debounce delays until the last call and supports flush/cancel', async () => {
  const calls = [];
  const debounced = debounce((value) => calls.push(value), 20);

  debounced('a');
  debounced('b');
  expect(calls).toEqual([]);
  debounced.flush();
  expect(calls).toEqual(['b']);

  debounced('c');
  debounced.cancel();
  await sleep(25);
  expect(calls).toEqual(['b']);
});

test('throttle invokes immediately and keeps the latest trailing call', async () => {
  const calls = [];
  const throttled = throttle((value) => calls.push(value), 20);

  throttled('a');
  throttled('b');
  throttled('c');
  expect(calls).toEqual(['a']);
  await sleep(25);
  expect(calls).toEqual(['a', 'c']);
});
