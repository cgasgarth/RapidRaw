export type DebouncedFunction<TArgs extends Array<unknown>> = ((...args: TArgs) => void) & {
  cancel: () => void;
  flush: () => void;
};

export type ThrottledFunction<TArgs extends Array<unknown>> = ((...args: TArgs) => void) & {
  cancel: () => void;
  flush: () => void;
};

export function debounce<TArgs extends Array<unknown>>(
  callback: (...args: TArgs) => unknown,
  waitMs: number,
): DebouncedFunction<TArgs> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: TArgs | null = null;

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pendingArgs = null;
  };

  const flush = () => {
    if (pendingArgs === null) return;
    const args = pendingArgs;
    cancel();
    callback(...args);
  };

  const debounced = ((...args: TArgs) => {
    pendingArgs = args;
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(flush, waitMs);
  }) as DebouncedFunction<TArgs>;

  debounced.cancel = cancel;
  debounced.flush = flush;
  return debounced;
}

export function throttle<TArgs extends Array<unknown>>(
  callback: (...args: TArgs) => unknown,
  waitMs: number,
): ThrottledFunction<TArgs> {
  let lastInvokeAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: TArgs | null = null;

  const invoke = (args: TArgs) => {
    lastInvokeAt = Date.now();
    callback(...args);
  };

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pendingArgs = null;
  };

  const flush = () => {
    if (pendingArgs === null) return;
    const args = pendingArgs;
    cancel();
    invoke(args);
  };

  const throttled = ((...args: TArgs) => {
    const remainingMs = waitMs - (Date.now() - lastInvokeAt);

    if (remainingMs <= 0 || lastInvokeAt === 0) {
      cancel();
      invoke(args);
      return;
    }

    pendingArgs = args;
    if (timer === null) {
      timer = setTimeout(flush, remainingMs);
    }
  }) as ThrottledFunction<TArgs>;

  throttled.cancel = cancel;
  throttled.flush = flush;
  return throttled;
}
