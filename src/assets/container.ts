import { BundleError } from "./errors";
import { BUNDLE_LIMITS, NESTED_ARCHIVE, pathProblem, type BundleLimits } from "./paths";

// The container step (specification §8.1 steps 1–3): read entries from a folder map or a STORE ZIP, validate every path
// and bound, and refuse duplicates before any manifest is trusted. Both containers end here.

export const MANIFEST = "manifest.json";

/** Bundle-root-relative path → bytes. */
export type BundleEntries = ReadonlyMap<string, Uint8Array>;

export interface BundleContainer {
  readonly kind: "folder" | "zip";
  /** The one wrapper folder the bundle sat in (RigLab zips hold `riglab-export/`), or null when it sat at the root. */
  readonly root: string | null;
  /** Entries in code-unit path order. */
  readonly entries: BundleEntries;
}

/** Counts entries and bytes against the limits, from declared sizes, so an oversized entry is refused unread. */
export class EntryBudget {
  private count = 0;
  private total = 0;

  constructor(private readonly limits: BundleLimits) {}

  take(path: string, bytes: number): void {
    this.count += 1;
    if (this.count > this.limits.entries) throw new BundleError("container.limit", path, `more than ${this.limits.entries} entries`);
    if (bytes > this.limits.entryBytes) {
      throw new BundleError("container.limit", path, `${bytes} bytes exceeds the ${this.limits.entryBytes}-byte entry limit`);
    }
    this.total += bytes;
    if (this.total > this.limits.totalBytes) {
      throw new BundleError("container.limit", path, `entries exceed the ${this.limits.totalBytes}-byte bundle limit`);
    }
  }
}

/**
 * A folder map: relative POSIX paths to bytes, as a directory picker or a set of fetched files yields them. Pairs are
 * taken in order, so a repeated path is refused rather than silently replaced.
 */
export function readFolder(files: Iterable<readonly [string, Uint8Array]>, limits: BundleLimits = BUNDLE_LIMITS): BundleContainer {
  const budget = new EntryBudget(limits);
  const list: [string, Uint8Array][] = [];
  for (const [path, bytes] of files) {
    budget.take(path, bytes.length);
    list.push([path, bytes]);
  }
  return collectEntries("folder", list, [], limits);
}

const folderOf = (path: string): string => path.slice(0, path.lastIndexOf("/"));

/** Validates paths, refuses duplicates, case aliases, file/folder conflicts and empty folders, then finds the root. */
export function collectEntries(
  kind: BundleContainer["kind"],
  files: readonly (readonly [string, Uint8Array])[],
  directories: readonly string[],
  limits: BundleLimits,
): BundleContainer {
  const seen = new Map<string, string>();
  const folders = new Set<string>();
  for (const [path] of files) {
    const problem = pathProblem(path, limits);
    if (problem) throw new BundleError("container.path", path, `unsafe entry path: ${problem}`);
    if (NESTED_ARCHIVE.test(path)) throw new BundleError("container.nested-archive", path, "nested archives are refused");
    const key = path.toLowerCase();
    const earlier = seen.get(key);
    if (earlier === path) throw new BundleError("container.duplicate", path, "the entry appears twice");
    if (earlier !== undefined) throw new BundleError("container.duplicate", path, `the entry differs only in case from ${earlier}`);
    seen.set(key, path);
    for (let folder = folderOf(key); folder; folder = folderOf(folder)) folders.add(folder);
  }
  for (const [path] of files) {
    if (folders.has(path.toLowerCase())) throw new BundleError("container.conflict", path, "the path is both a file and a folder");
  }
  for (const directory of directories) {
    const problem = pathProblem(directory, limits);
    if (problem) throw new BundleError("container.path", `${directory}/`, `unsafe folder path: ${problem}`);
    if (seen.has(directory.toLowerCase())) throw new BundleError("container.conflict", `${directory}/`, "the path is both a file and a folder");
    if (!folders.has(directory.toLowerCase())) throw new BundleError("container.empty-directory", `${directory}/`, "bundles carry files, not empty folders");
  }
  const root = wrapperFolder(files.map(([path]) => path));
  const strip = root === null ? 0 : root.length + 1;
  const entries = files.map(([path, bytes]) => [path.slice(strip), bytes] as const);
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return { kind, root, entries: new Map(entries) };
}

/** The single top-level folder holding every entry and the manifest, when no manifest sits at the root. */
function wrapperFolder(paths: readonly string[]): string | null {
  if (paths.length === 0 || paths.includes(MANIFEST)) return null;
  const first = paths[0]!.split("/")[0]!;
  const inside = paths.every((path) => path.startsWith(`${first}/`));
  return inside && paths.includes(`${first}/${MANIFEST}`) ? first : null;
}
