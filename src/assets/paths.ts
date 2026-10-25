// Bundle entry paths and container bounds. The path grammar is MapLab's portable one (maplab.export v1 `path`): POSIX
// segments of letters, digits, `.`, `_` and `-`, never starting with `.` or `-` and never ending with `.`, so `..`,
// hidden files, absolute paths, backslashes and empty segments cannot be spelled. RigLab's export paths fit it too.

export interface BundleLimits {
  /** Entries in one container; a ZIP's folder records count too. */
  readonly entries: number;
  /** Bytes in one entry. */
  readonly entryBytes: number;
  /** Bytes across every entry. */
  readonly totalBytes: number;
  /** Folders above an entry. */
  readonly depth: number;
  /** Characters in an entry path; the grammar is ASCII, so characters are bytes. */
  readonly pathLength: number;
}

/** MapLab's reader bounds (20,000 files, 512 MiB, 16 folders deep, 240-byte paths), plus 256 MiB per entry. */
export const BUNDLE_LIMITS: BundleLimits = Object.freeze({
  entries: 20_000,
  entryBytes: 256 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  depth: 16,
  pathLength: 240,
});

const SEGMENT = /^[A-Za-z0-9_](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;
/** Windows device names stay unsafe with any extension, in any case. */
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
/** A nested archive would hide entries from the inventory and from these bounds. */
export const NESTED_ARCHIVE = /\.(?:zip|jar|7z|rar|tar|gz|tgz|bz2|xz|zst)$/i;

/** Null for a safe bundle-relative path, otherwise what is wrong with it. */
export function pathProblem(path: string, limits: BundleLimits = BUNDLE_LIMITS): string | null {
  if (path.length === 0) return "it is empty";
  if (path.length > limits.pathLength) return `it is longer than ${limits.pathLength} characters`;
  const segments = path.split("/");
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) return `segment ${JSON.stringify(segment)} is not a portable file name`;
    if (RESERVED.test(segment)) return `segment ${JSON.stringify(segment)} is a reserved device name`;
  }
  if (segments.length - 1 > limits.depth) return `it is nested more than ${limits.depth} folders deep`;
  return null;
}
