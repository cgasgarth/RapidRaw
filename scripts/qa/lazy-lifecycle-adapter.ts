import type { QaLifecycleAdapter } from './daemon-engine';

export function createLazyLifecycleAdapter<Session, Result>(
  load: () => Promise<QaLifecycleAdapter<Session, Result>>,
): QaLifecycleAdapter<Session, Result> {
  let adapter: Promise<QaLifecycleAdapter<Session, Result>> | undefined;
  const resolveAdapter = () => (adapter ??= load());

  return {
    async start(identity) {
      return await (await resolveAdapter()).start(identity);
    },
    async stop(session) {
      await (await resolveAdapter()).stop(session);
    },
    async refresh(session, identity, metrics) {
      return await (await resolveAdapter()).refresh?.(session, identity, metrics);
    },
    async run(session, job, metrics, signal) {
      return await (await resolveAdapter()).run(session, job, metrics, signal);
    },
  };
}
