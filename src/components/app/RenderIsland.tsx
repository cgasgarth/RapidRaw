import { memo, Profiler, type ReactNode } from 'react';
import { getViteEnv } from '../../utils/frontendEnv.mjs';
import { recordIslandCommit, recordIslandRender } from './renderProfiler';

function RenderIslandComponent({ children, name }: { children: ReactNode; name: string }) {
  recordIslandRender(name);
  return getViteEnv().DEV ? (
    <Profiler id={name} onRender={recordIslandCommit}>
      {children}
    </Profiler>
  ) : (
    children
  );
}

export const RenderIsland = memo(RenderIslandComponent);
