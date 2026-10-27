import { DEPENDENCY_KINDS } from "./contracts";
import { isObject, type JsonObject, type MapLabDocument } from "./documents";
import { MapLabError } from "./errors";

// Specification §8.1 step 9: dependency closure. Each document's `dependencies` must name bundled documents by their
// manifest path and format; a required one must be present, an absent optional one keeps one path across the bundle
// and never aliases a bundled file. Every document must be reachable from the entry map, so nothing in the bundle
// is unaccounted for.

export interface Closure {
  readonly entry: MapLabDocument;
  readonly documents: ReadonlyMap<string, MapLabDocument>;
  /** Each document's ID → the IDs of every document it depends on, directly or transitively, itself excluded. */
  readonly reach: ReadonlyMap<string, ReadonlySet<string>>;
}

const MANIFEST = "manifest.json";

export function dependenciesOf(document: MapLabDocument): readonly JsonObject[] {
  const dependencies = document.value.dependencies;
  return Array.isArray(dependencies) ? (dependencies.filter(isObject)) : [];
}

export function resolveClosure(documents: readonly MapLabDocument[], entryMapId: string, listed: ReadonlySet<string>): Closure {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const paths = new Set(documents.map((document) => document.path));
  const optional = new Map<string, string>();
  const edges = new Map<string, string[]>();
  for (const document of documents) {
    const seen = new Set<string>();
    const targets: string[] = [];
    dependenciesOf(document).forEach((dependency, i) => {
      const at = `$.dependencies[${i}]`;
      const { id, kind, path, required } = dependency as { id: string; kind: string; path: string; required: boolean };
      if (seen.has(id)) throw new MapLabError("dependency.duplicate", document.path, at, `${id} is declared more than once`);
      seen.add(id);
      if (kind === "riglab") {
        throw new MapLabError("adapter.unsupported", document.path, at, "RigLab presentation dependencies are read by the RigLab adapter (RLDR-011), which this reader does not yet use");
      }
      const target = byId.get(id);
      if (target) {
        if (target.path !== path || DEPENDENCY_KINDS[kind] !== target.format) {
          throw new MapLabError("dependency.identity", document.path, at, `${id} is bundled as ${target.format} at ${target.path}`);
        }
        targets.push(id);
      } else if (required) {
        throw new MapLabError("dependency.missing", document.path, at, `the required dependency ${id} (${path}) is not in the bundle`);
      } else {
        if (paths.has(path) || listed.has(path)) throw new MapLabError("dependency.path-alias", document.path, `${at}.path`, `the absent optional ${id} names the bundled file ${path}`);
        const earlier = optional.get(id);
        if (earlier !== undefined && earlier !== path) {
          throw new MapLabError("dependency.path-identity", document.path, `${at}.path`, `the absent optional ${id} is declared elsewhere at ${earlier}`);
        }
        optional.set(id, path);
      }
    });
    edges.set(document.id, targets);
  }

  const entry = byId.get(entryMapId);
  if (!entry || entry.format !== "maplab.map") throw new MapLabError("closure.entry", MANIFEST, "$.entryMapId", `${entryMapId} is not a bundled map`);
  const reachOf = (start: string): Set<string> => {
    const found = new Set<string>();
    const queue = [...(edges.get(start) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (found.has(id) || id === start) continue;
      found.add(id);
      queue.push(...(edges.get(id) ?? []));
    }
    return found;
  };
  const reach = new Map(documents.map((document) => [document.id, reachOf(document.id)]));
  const fromEntry = new Set([entry.id, ...reach.get(entry.id)!]);
  const stray = documents.find((document) => !fromEntry.has(document.id));
  if (stray) throw new MapLabError("closure.unreachable", MANIFEST, "$.documents", `${stray.id} is not reachable from the entry map ${entry.id}`);
  return { entry, documents: byId, reach };
}
