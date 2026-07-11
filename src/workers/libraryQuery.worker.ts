/// <reference lib="webworker" />

import type { LibraryQueryWorkerCommand } from '../library/libraryQueryWorkerProtocol';
import { createLibraryQueryRuntime } from './libraryQueryRuntime';

const runtime = createLibraryQueryRuntime((result) => postMessage(result));

addEventListener('message', (event: MessageEvent<LibraryQueryWorkerCommand>) => {
  runtime.handle(event.data);
  if (event.data.type === 'dispose') close();
});
