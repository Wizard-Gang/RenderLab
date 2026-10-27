// Chunk residency (specification §8.2, §12.4, §15.2): which chunks have built GPU geometry, which of those the frame
// submits, and which to release. Generic over what a build produces, so node tests the accounting without a GPU.

export interface ChunkBuilder<Id, Built> {
  build(id: Id): Built;
  /** Release everything `build` made. */
  release(built: Built): void;
}

export interface TerrainSettings {
  /** Whole chunks preloaded beyond each edge of the view, so panning finds them built. */
  readonly marginChunks: number;
  /** The most chunks kept built. Chunks the view needs are never evicted, so a huge view can exceed it. */
  readonly chunkBudget: number;
}

export const DEFAULT_TERRAIN: TerrainSettings = Object.freeze({ marginChunks: 1, chunkBudget: 64 });

export function terrainSettingsProblems(settings: TerrainSettings): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(settings.marginChunks) || settings.marginChunks < 0 || settings.marginChunks > 8) problems.push("marginChunks: must be a whole number from 0 to 8");
  if (!Number.isInteger(settings.chunkBudget) || settings.chunkBudget < 1 || settings.chunkBudget > 4096) problems.push("chunkBudget: must be a whole number from 1 to 4096");
  return problems;
}

/** Counters since the scene mounted, and the current sizes. */
export interface TerrainStats {
  /** Chunks the scene holds. */
  readonly chunks: number;
  /** Chunks the frame submits: inside the view plus its margin. */
  readonly active: number;
  /** Chunks with built geometry, active or kept for reuse. */
  readonly resident: number;
  readonly budget: number;
  /** Geometry built for a chunk that had none. */
  readonly builds: number;
  /** Geometry rebuilt because the chunk's cells changed while it was active. */
  readonly rebuilds: number;
  /** Inactive chunks released to stay within the budget. */
  readonly evictions: number;
  readonly activations: number;
  readonly deactivations: number;
}

/**
 * Tracks every chunk of a scene. `show` makes exactly the wanted chunks active, building any without geometry and
 * keeping the rest built while the budget allows; `invalidate` rebuilds one changed chunk and touches no other.
 * Inactive chunks are evicted least recently used first.
 */
export class ChunkResidency<Id, Built> {
  readonly #builder: ChunkBuilder<Id, Built>;
  readonly #budget: number;
  readonly #known = new Set<Id>();
  readonly #active = new Map<Id, Built>();
  /** Built but not submitted, oldest first. */
  readonly #idle = new Map<Id, Built>();
  #builds = 0;
  #rebuilds = 0;
  #evictions = 0;
  #activations = 0;
  #deactivations = 0;

  constructor(builder: ChunkBuilder<Id, Built>, budget: number) {
    this.#builder = builder;
    this.#budget = budget;
  }

  track(id: Id): void {
    this.#known.add(id);
  }

  /** The chunk left the scene: release its geometry. */
  forget(id: Id): void {
    this.#known.delete(id);
    this.#drop(id);
  }

  /** The chunk's cells or placement changed. Active geometry is rebuilt now; idle geometry is released as stale. */
  invalidate(id: Id): Built | undefined {
    const active = this.#active.get(id);
    if (active !== undefined) {
      this.#builder.release(active);
      const built = this.#builder.build(id);
      this.#active.set(id, built);
      this.#rebuilds += 1;
      return built;
    }
    const idle = this.#idle.get(id);
    if (idle !== undefined) {
      this.#builder.release(idle);
      this.#idle.delete(id);
    }
    return undefined;
  }

  /** Make exactly `wanted` (of the tracked chunks) active. Returns what changed so the caller can attach and detach. */
  show(wanted: Iterable<Id>): { activated: [Id, Built][]; deactivated: [Id, Built][] } {
    const next = new Set([...wanted].filter((id) => this.#known.has(id)));
    const deactivated: [Id, Built][] = [];
    for (const [id, built] of this.#active) {
      if (next.has(id)) continue;
      this.#active.delete(id);
      this.#idle.set(id, built);
      deactivated.push([id, built]);
    }
    const activated: [Id, Built][] = [];
    for (const id of next) {
      if (this.#active.has(id)) continue;
      let built = this.#idle.get(id);
      if (built === undefined) {
        built = this.#builder.build(id);
        this.#builds += 1;
      } else this.#idle.delete(id);
      this.#active.set(id, built);
      activated.push([id, built]);
    }
    this.#activations += activated.length;
    this.#deactivations += deactivated.length;
    for (const [id, built] of this.#idle) {
      if (this.#active.size + this.#idle.size <= this.#budget) break;
      this.#builder.release(built);
      this.#idle.delete(id);
      this.#evictions += 1;
    }
    return { activated, deactivated };
  }

  isActive(id: Id): boolean {
    return this.#active.has(id);
  }

  built(id: Id): Built | undefined {
    return this.#active.get(id) ?? this.#idle.get(id);
  }

  activeIds(): Id[] {
    return [...this.#active.keys()];
  }

  stats(): TerrainStats {
    return {
      chunks: this.#known.size, active: this.#active.size, resident: this.#active.size + this.#idle.size, budget: this.#budget,
      builds: this.#builds, rebuilds: this.#rebuilds, evictions: this.#evictions,
      activations: this.#activations, deactivations: this.#deactivations,
    };
  }

  /** Release every chunk's geometry. */
  clear(): void {
    for (const built of [...this.#active.values(), ...this.#idle.values()]) this.#builder.release(built);
    this.#active.clear();
    this.#idle.clear();
    this.#known.clear();
  }

  #drop(id: Id): void {
    const built = this.#active.get(id) ?? this.#idle.get(id);
    if (built !== undefined) this.#builder.release(built);
    this.#active.delete(id);
    this.#idle.delete(id);
  }
}
