import { expect, test } from 'bun:test';

import { createBrowserHarnessReleaseGate } from '../../../src/validation/browserHarnessReleaseGate';

test('holds exactly one harness completion until its visible-state proof releases it', async () => {
  const gate = createBrowserHarnessReleaseGate();
  let completed = false;

  gate.holdNext();
  const completion = gate.wait(0).then(() => {
    completed = true;
  });
  await Bun.sleep(0);
  expect(completed).toBeFalse();
  expect(gate.releaseHeld()).toBeTrue();
  await completion;
  expect(completed).toBeTrue();
  expect(gate.releaseHeld()).toBeFalse();

  await gate.wait(0);
});

test('rejects a second hold instead of silently orphaning the first completion', () => {
  const gate = createBrowserHarnessReleaseGate();
  gate.holdNext();
  expect(() => gate.holdNext()).toThrow('A browser harness completion is already held.');
});

test('does not release a reservation before the matching completion reaches the gate', async () => {
  const gate = createBrowserHarnessReleaseGate();
  let completed = false;

  gate.holdNext();
  expect(gate.releaseHeld()).toBeFalse();
  const completion = gate.wait(0).then(() => {
    completed = true;
  });
  await Bun.sleep(0);
  expect(completed).toBeFalse();
  expect(gate.releaseHeld()).toBeTrue();
  await completion;
  expect(completed).toBeTrue();
});
