// Why a delta cannot be presented, checked before the scene store changes so a refused delta changes nothing.
// Malformed changes are left to the store, which rejects them with its own messages.
import type { ObjectId, ResourceId, SceneChange, SceneDelta, SceneObject, TileChunkObject } from "../../core";
import { SUPPORTED_KINDS, unsupportedObjects } from "./scene-graph";

export interface Loaded {
  texture(id: unknown): boolean;
  /** A loaded tileset's tile IDs, or undefined when it was not loaded. */
  tiles(id: unknown): ReadonlySet<string> | ReadonlyMap<string, unknown> | undefined;
  /** The scene object as the store holds it now. */
  object(id: ObjectId): SceneObject | undefined;
}

type Loose = Record<string, unknown>;
const tilesOf = (cells: unknown): string[] =>
  (Array.isArray(cells) ? cells : []).flatMap((cell) => (typeof (cell as Loose | null)?.tile === "string" ? [(cell as Loose).tile as string] : []));

export function refusals(delta: SceneDelta, loaded: Loaded): string[] {
  // Chunks as earlier changes of this delta leave them, so later changes check against the right tileset.
  const pending = new Map<ObjectId, TileChunkObject>();
  const chunkCheck = (at: string, tileset: unknown, tiles: readonly string[]): string[] => {
    const known = loaded.tiles(tileset);
    if (!known) return [`${at}: tileset ${String(tileset)} was not declared when the scene mounted`];
    return [...new Set(tiles)].filter((tile) => !known.has(tile)).map((tile) => `${at}: tileset ${String(tileset)} has no tile ${tile}`);
  };
  return (Array.isArray(delta) ? delta : []).flatMap((change: SceneChange, index) => {
    const at = `delta[${index}]`;
    if (change?.op === "add" && change.object && !SUPPORTED_KINDS.includes(change.object.kind)) {
      return unsupportedObjects([change.object]).map((reason) => `${at}: ${reason}`);
    }
    if (change?.op === "add" && change.object?.kind === "sprite" && !loaded.texture(change.object.texture)) {
      return [`${at}: texture ${change.object.texture} was not declared when the scene mounted`];
    }
    if (change?.op === "add" && change.object?.kind === "tile-chunk") {
      pending.set(change.object.id, change.object);
      return chunkCheck(at, change.object.tileset, tilesOf(change.object.cells));
    }
    if (change?.op === "update" && change.patch && "texture" in change.patch && !loaded.texture(change.patch.texture)) {
      return [`${at}: texture ${String(change.patch.texture)} was not declared when the scene mounted`];
    }
    if ((change?.op === "update" || change?.op === "set-cells") && change.id) {
      const chunk = pending.get(change.id) ?? loaded.object(change.id);
      if (chunk?.kind !== "tile-chunk") return [];
      if (change.op === "set-cells") {
        return chunkCheck(at, chunk.tileset, tilesOf((Array.isArray(change.cells) ? change.cells : []).map((entry) => (entry as Loose | null)?.cell)));
      }
      const patch = (change.patch ?? {}) as Partial<TileChunkObject>;
      const next = { ...chunk, ...patch } as TileChunkObject;
      pending.set(change.id, next);
      return "tileset" in patch || "cells" in patch ? chunkCheck(at, next.tileset, tilesOf(next.cells)) : [];
    }
    if (change?.op === "add-resource" && change.resource?.kind === "texture" && !loaded.texture(change.resource.id)) {
      return [`${at}: textures are loaded when a scene mounts; on-demand loading arrives with RLDR-006`];
    }
    if (change?.op === "add-resource" && change.resource?.kind === "tileset" && !loaded.tiles(change.resource.id as ResourceId)) {
      return [`${at}: tilesets are loaded when a scene mounts`];
    }
    return [];
  });
}
