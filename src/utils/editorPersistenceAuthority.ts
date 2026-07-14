export interface EditorPersistenceAuthorityReceipt {
  path: string;
  sidecarRevision: string;
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const isReceipt = (value: unknown): value is EditorPersistenceAuthorityReceipt => {
  if (typeof value !== 'object' || value === null) return false;
  const path = Reflect.get(value, 'path');
  const sidecarRevision = Reflect.get(value, 'sidecarRevision');
  return typeof path === 'string' && typeof sidecarRevision === 'string' && sidecarRevision.startsWith('sha256:');
};

export class EditorPersistenceAuthorityLedger {
  private readonly completed = new Map<string, EditorPersistenceAuthorityReceipt>();
  private readonly pendingByPath = new Map<string, Set<Promise<unknown>>>();

  constructor(private readonly maxCompleted = 32) {}

  private key(path: string, document: unknown): string {
    return `${path}\0${canonicalJson(document)}`;
  }

  track(path: string, document: unknown, persistence: Promise<unknown>): Promise<unknown> {
    const pending = this.pendingByPath.get(path) ?? new Set<Promise<unknown>>();
    this.pendingByPath.set(path, pending);
    const tracked = persistence
      .then((receipt) => {
        if (isReceipt(receipt)) {
          const key = this.key(path, document);
          this.completed.delete(key);
          this.completed.set(key, receipt);
          while (this.completed.size > this.maxCompleted) {
            const oldest = this.completed.keys().next().value;
            if (typeof oldest !== 'string') break;
            this.completed.delete(oldest);
          }
        }
        return receipt;
      })
      .finally(() => {
        pending.delete(tracked);
        if (pending.size === 0) this.pendingByPath.delete(path);
      });
    pending.add(tracked);
    return tracked;
  }

  async receiptFor(path: string, document: unknown): Promise<EditorPersistenceAuthorityReceipt | null> {
    // A failed in-flight save is not a barrier receipt. Let the caller fall back
    // to an immediate save instead of aborting the higher-level operation.
    await Promise.allSettled([...(this.pendingByPath.get(path) ?? [])]);
    return this.completed.get(this.key(path, document)) ?? null;
  }
}
