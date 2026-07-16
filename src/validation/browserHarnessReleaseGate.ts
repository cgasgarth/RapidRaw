export interface BrowserHarnessReleaseGate {
  holdNext(): void;
  releaseHeld(): boolean;
  wait(delayMs: number): Promise<void>;
}

export const createBrowserHarnessReleaseGate = (): BrowserHarnessReleaseGate => {
  let shouldHoldNextCompletion = false;
  let release: (() => void) | undefined;

  return {
    holdNext() {
      if (shouldHoldNextCompletion || release !== undefined) {
        throw new Error('A browser harness completion is already held.');
      }
      shouldHoldNextCompletion = true;
    },
    releaseHeld() {
      if (release === undefined) return false;
      release();
      release = undefined;
      return true;
    },
    wait(delayMs) {
      if (!shouldHoldNextCompletion) return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
      shouldHoldNextCompletion = false;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  };
};
