const MAX_PROTECTED_SESSIONS = 64;

export class NativeCommittedHydrationAuthority {
  private readonly protectedSessions = new Map<string, string>();

  constructor(private readonly maxProtectedSessions = MAX_PROTECTED_SESSIONS) {}

  protect(sessionId: string, transactionId: string): void {
    this.protectedSessions.delete(sessionId);
    this.protectedSessions.set(sessionId, transactionId);
    while (this.protectedSessions.size > this.maxProtectedSessions) {
      const oldest = this.protectedSessions.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.protectedSessions.delete(oldest);
    }
  }

  isProtected(sessionId: string): boolean {
    return this.protectedSessions.has(sessionId);
  }
}

const nativeCommittedHydrationAuthority = new NativeCommittedHydrationAuthority();

export const protectNativeCommittedHydrationSession = (sessionId: string, transactionId: string): void => {
  nativeCommittedHydrationAuthority.protect(sessionId, transactionId);
};

export const isNativeCommittedHydrationSession = (sessionId: string): boolean =>
  nativeCommittedHydrationAuthority.isProtected(sessionId);
