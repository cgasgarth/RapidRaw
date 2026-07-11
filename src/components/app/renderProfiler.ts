import type { ProfilerOnRenderCallback } from 'react';
import { getViteEnv } from '../../utils/frontendEnv.mjs';

const isDevelopment = getViteEnv().DEV;

export interface RenderProfile {
  commits: number;
  maxCommitDuration: number;
  renders: number;
  totalCommitDuration: number;
}

const profiles = new Map<string, RenderProfile>();
let scenario = 'unlabeled';

const profileFor = (id: string): RenderProfile => {
  const current = profiles.get(id);
  if (current) return current;
  const next = { commits: 0, maxCommitDuration: 0, renders: 0, totalCommitDuration: 0 };
  profiles.set(id, next);
  return next;
};

export const recordIslandRender = (id: string) => {
  if (!isDevelopment) return;
  profileFor(`${scenario}:${id}`).renders += 1;
};

export const recordIslandCommit: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  if (!isDevelopment) return;
  const profile = profileFor(`${scenario}:${id}`);
  profile.commits += 1;
  profile.totalCommitDuration += actualDuration;
  profile.maxCommitDuration = Math.max(profile.maxCommitDuration, actualDuration);
};

export const appRenderProfiler = {
  beginScenario(name: string) {
    scenario = name;
  },
  reset() {
    profiles.clear();
    scenario = 'unlabeled';
  },
  snapshot() {
    return Object.fromEntries(profiles);
  },
};

declare global {
  interface Window {
    __RAPIDRAW_RENDER_PROFILER__?: typeof appRenderProfiler;
  }
}

if (isDevelopment && typeof window !== 'undefined') {
  window.__RAPIDRAW_RENDER_PROFILER__ = appRenderProfiler;
}
