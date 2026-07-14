export type OperationLifecycle =
  | 'idle'
  | 'preparing'
  | 'ready-for-review'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'closed';

export interface OperationLaunch {
  kind: string;
  launchId: string;
  openedAtRevision: number;
  sourcePaths: readonly string[];
}

export interface OperationSession {
  error: string | null;
  launch: OperationLaunch;
  lifecycle: OperationLifecycle;
  progress: number | null;
}

export type OperationEvent =
  | { type: 'prepare'; launchId: string }
  | { type: 'ready'; launchId: string }
  | { type: 'start'; launchId: string }
  | { type: 'progress'; launchId: string; progress: number }
  | { type: 'complete'; launchId: string }
  | { type: 'fail'; error: string; launchId: string }
  | { type: 'cancel'; launchId: string }
  | { type: 'close'; launchId: string };

const isCurrentLaunch = (session: OperationSession, event: OperationEvent): boolean =>
  event.launchId === session.launch.launchId;

/** Pure lifecycle reducer shared by long-running operation controllers. */
export const reduceOperationSession = (session: OperationSession, event: OperationEvent): OperationSession => {
  if (!isCurrentLaunch(session, event)) return session;
  switch (event.type) {
    case 'prepare':
      if (session.lifecycle !== 'idle') return session;
      return { ...session, error: null, lifecycle: 'preparing' };
    case 'ready':
      if (session.lifecycle !== 'preparing') return session;
      return { ...session, error: null, lifecycle: 'ready-for-review' };
    case 'start':
      if (session.lifecycle !== 'idle' && session.lifecycle !== 'ready-for-review') return session;
      return { ...session, error: null, lifecycle: 'running', progress: 0 };
    case 'progress':
      if (session.lifecycle !== 'running') return session;
      return { ...session, progress: Math.max(0, Math.min(1, event.progress)) };
    case 'complete':
      if (session.lifecycle !== 'running') return session;
      return { ...session, error: null, lifecycle: 'completed', progress: 1 };
    case 'fail':
      if (session.lifecycle === 'closed' || session.lifecycle === 'completed') return session;
      return { ...session, error: event.error, lifecycle: 'failed' };
    case 'cancel':
      if (
        session.lifecycle !== 'preparing' &&
        session.lifecycle !== 'ready-for-review' &&
        session.lifecycle !== 'running'
      ) {
        return session;
      }
      return { ...session, error: null, lifecycle: 'cancelling' };
    case 'close':
      if (session.lifecycle === 'closed') return session;
      return { ...session, error: null, lifecycle: 'closed', progress: null };
  }
};

export const createOperationSession = (launch: OperationLaunch): OperationSession => ({
  error: null,
  launch: { ...launch, sourcePaths: [...launch.sourcePaths] },
  lifecycle: 'idle',
  progress: null,
});
