import type { ResourceId } from "../core/contracts/ids";

// The reference-counted loading lifecycle (specification §12.2–12.3). Resources are keyed by content ID, so every scene
// that needs the same bytes shares one load and one value. Each acquire returns a lease; the value is disposed when
// the last lease is released, never while another scene still holds one. A failed load rejects every waiting lease
// and leaves nothing behind, so the next acquire retries.

export type ResourceState = "loading" | "ready";

export interface ResourceLease<T> {
  readonly id: ResourceId;
  /** Resolves with the shared value, or rejects with the load's error. */
  readonly ready: Promise<T>;
  readonly released: boolean;
  /** Gives up this lease; the last release disposes the value. A second release throws. */
  release(): void;
}

export interface ResourceEntrySnapshot {
  readonly id: ResourceId;
  readonly state: ResourceState;
  readonly refs: number;
}

interface Entry<T> {
  state: ResourceState;
  refs: number;
  value: T | undefined;
  readonly ready: Promise<T>;
}

export class ResourceRegistry<T> {
  private readonly entries = new Map<ResourceId, Entry<T>>();

  /** `dispose` frees a value (textures, buffers) once no lease holds it. */
  constructor(private readonly dispose: (value: T, id: ResourceId) => void) {}

  /** Leases `id`, starting `load` only when no load or value exists for it yet. */
  acquire(id: ResourceId, load: (id: ResourceId) => Promise<T>): ResourceLease<T> {
    const entry = this.entries.get(id) ?? this.start(id, load);
    entry.refs += 1;
    let released = false;
    return {
      id,
      ready: entry.ready,
      get released() {
        return released;
      },
      release: () => {
        if (released) throw new Error(`The lease on ${id} was already released`);
        released = true;
        // A lease from a failed load no longer counts: its entry is gone, and a retry's entry is not its own.
        if (this.entries.get(id) !== entry) return;
        entry.refs -= 1;
        if (entry.refs === 0 && entry.state === "ready") this.drop(id, entry);
      },
    };
  }

  /** Live leases on `id`; 0 when it is not held. */
  refs(id: ResourceId): number {
    return this.entries.get(id)?.refs ?? 0;
  }

  /** Every held resource in ID order, for diagnostics. */
  snapshot(): readonly ResourceEntrySnapshot[] {
    return [...this.entries]
      .map(([id, entry]) => ({ id, state: entry.state, refs: entry.refs }))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  }

  private start(id: ResourceId, load: (id: ResourceId) => Promise<T>): Entry<T> {
    const ready = Promise.resolve().then(() => load(id));
    const entry: Entry<T> = { state: "loading", refs: 0, value: undefined, ready };
    this.entries.set(id, entry);
    ready.then(
      (value) => {
        if (this.entries.get(id) !== entry) return;
        entry.value = value;
        entry.state = "ready";
        // Every lease was released while loading: nothing holds the value.
        if (entry.refs === 0) this.drop(id, entry);
      },
      () => {
        if (this.entries.get(id) === entry) this.entries.delete(id);
      },
    );
    return entry;
  }

  private drop(id: ResourceId, entry: Entry<T>): void {
    this.entries.delete(id);
    this.dispose(entry.value as T, id);
  }
}
