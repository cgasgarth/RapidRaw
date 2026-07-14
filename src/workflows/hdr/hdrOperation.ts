import {
  createOperationSession,
  type OperationEvent,
  type OperationLaunch,
  type OperationSession,
  reduceOperationSession,
} from '../operationLifecycle';

export type HdrOperationEvent = OperationEvent;

export const createHdrOperationSession = (launch: OperationLaunch): OperationSession =>
  createOperationSession({ ...launch, kind: 'hdr' });

export const reduceHdrOperationSession = (session: OperationSession, event: HdrOperationEvent): OperationSession =>
  reduceOperationSession(session, event);
