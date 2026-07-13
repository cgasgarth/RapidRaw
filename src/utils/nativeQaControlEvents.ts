import type { z } from 'zod';
import type { nativeQaOpenFixturePayloadSchema, nativeQaResetPayloadSchema } from '../schemas/tauriEventSchemas';

type NativeQaResetPayload = z.infer<typeof nativeQaResetPayloadSchema>;
type NativeQaOpenFixturePayload = z.infer<typeof nativeQaOpenFixturePayloadSchema>;

export interface NativeQaNavigation {
  openImagePath(path: string): void;
  resetToEmpty(): void;
  resetToLibrary(): void;
}

type Scheduler = (operation: () => void) => void;

export function applyNativeQaReset(
  payload: NativeQaResetPayload,
  navigation: NativeQaNavigation,
  schedule: Scheduler = queueMicrotask,
): void {
  if (payload.mode === 'empty') {
    navigation.resetToEmpty();
  } else if (payload.mode === 'library') {
    navigation.resetToLibrary();
  } else if (payload.sourcePath !== null) {
    const sourcePath = payload.sourcePath;
    navigation.resetToLibrary();
    schedule(() => navigation.openImagePath(sourcePath));
  }
}

export function applyNativeQaOpenFixture(
  payload: NativeQaOpenFixturePayload,
  navigation: NativeQaNavigation,
  schedule: Scheduler = queueMicrotask,
): void {
  navigation.resetToLibrary();
  schedule(() => navigation.openImagePath(payload.path));
}
