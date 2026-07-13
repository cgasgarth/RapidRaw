import { create } from 'zustand';
import type { NativeCapabilityManifest } from '../schemas/nativeCapabilitySchemas';

interface NativeCapabilityState {
  manifest: NativeCapabilityManifest | null;
  setManifest: (manifest: NativeCapabilityManifest) => void;
}

export const useNativeCapabilityStore = create<NativeCapabilityState>((set) => ({
  manifest: null,
  setManifest: (manifest) => set({ manifest }),
}));
