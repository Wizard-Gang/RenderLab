import { collectEntries, EntryBudget, type BundleContainer } from "./container";
import { BundleError } from "./errors";
import { BUNDLE_LIMITS, type BundleLimits } from "./paths";

// A bounded reader for STORE (uncompressed) ZIPs, the archive RigLab's export writes. Nothing is trusted unbounded: the
// end record must close the file, the central directory must sit before it, every local header must agree with its
// central record, data ranges must not overlap and each CRC-32 must match. Compression, encryption, ZIP64 and
// multi-disk archives are refused rather than half-read. Entry bytes are views into the archive, never copies.

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_SIZE = 22;
const MAX_COMMENT = 0xffff;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;
const HOST_UNIX = 3;
const FILE_TYPE = 0o170000;
const REGULAR = 0o100000;
const DIRECTORY = 0o040000;
const SYMLINK = 0o120000;
const STORE = 0;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const structure = (at: string | null, message: string) => new BundleError("zip.structure", at, message);
const utf8 = new TextDecoder("utf-8", { fatal: true });

function decodeName(bytes: Uint8Array, flags: number, index: number): string {
  if (flags & FLAG_UTF8) {
    try {
      return utf8.decode(bytes);
    } catch {
      throw new BundleError("zip.name", `#${index}`, "the entry name is flagged UTF-8 but is not valid UTF-8");
    }
  }
  if (bytes.some((byte) => byte >= 0x80)) throw new BundleError("zip.name", `#${index}`, "a name without the UTF-8 flag must be ASCII");
  return String.fromCharCode(...bytes);
}

const sameBytes = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((byte, i) => byte === right[i]);

/** Finds the end record that closes the archive exactly, scanning back over at most one maximal comment. */
function findEnd(bytes: Uint8Array, view: DataView): number {
  const lowest = Math.max(0, bytes.length - END_SIZE - MAX_COMMENT);
  for (let at = bytes.length - END_SIZE; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) === END_SIGNATURE && at + END_SIZE + view.getUint16(at + 20, true) === bytes.length) return at;
  }
  throw structure(null, "no end-of-central-directory record closes the archive");
}

interface Span {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

export function readZip(bytes: Uint8Array, limits: BundleLimits = BUNDLE_LIMITS): BundleContainer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(bytes, view);
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new BundleError("zip.unsupported", null, "ZIP64 archives are not read");
  }
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0 || view.getUint16(end + 8, true) !== count) {
    throw new BundleError("zip.unsupported", null, "multi-disk archives are not read");
  }
  if (count > limits.entries) throw new BundleError("container.limit", null, `${count} records exceed the ${limits.entries}-entry limit`);
  const directoryEnd = directoryOffset + directorySize;
  if (directoryEnd > end) throw structure(null, "the central directory overruns the end record");

  const budget = new EntryBudget(limits);
  const files: [string, Uint8Array][] = [];
  const directories: string[] = [];
  const spans: Span[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > directoryEnd || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw structure(`#${index}`, "the central directory record is missing or truncated");
    }
    const host = view.getUint16(cursor + 4, true) >>> 8;
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressed = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const next = cursor + 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    const mode = view.getUint32(cursor + 38, true) >>> 16;
    const offset = view.getUint32(cursor + 42, true);
    if (next > directoryEnd) throw structure(`#${index}`, "the central directory record overruns the directory");
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeName(nameBytes, flags, index);
    cursor = next;

    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) throw new BundleError("zip.encrypted", name, "encrypted entries are not read");
    if (method !== STORE) throw new BundleError("zip.compression", name, `compression method ${method} is not read; only STORE (0) is`);
    if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) {
      throw new BundleError("zip.unsupported", name, "ZIP64 entries are not read");
    }
    if (compressed !== size) throw structure(name, "a stored entry's compressed and uncompressed sizes differ");
    const type = host === HOST_UNIX ? mode & FILE_TYPE : 0;
    if (type !== 0 && type !== REGULAR && type !== DIRECTORY) {
      throw new BundleError("container.special-file", name, type === SYMLINK ? "symbolic links are refused" : "only regular files are read");
    }
    if (name.endsWith("/")) {
      if (size !== 0) throw structure(name, "a folder record carries data");
      directories.push(name.slice(0, -1));
      continue;
    }
    budget.take(name, size);

    if (offset + 30 > directoryOffset || view.getUint32(offset, true) !== LOCAL_SIGNATURE) {
      throw structure(name, "no local header sits at the recorded offset");
    }
    const localNameLength = view.getUint16(offset + 26, true);
    const start = offset + 30 + localNameLength + view.getUint16(offset + 28, true);
    if (start + size > directoryOffset) throw structure(name, "the entry's data overruns the central directory");
    if (view.getUint16(offset + 8, true) !== method || !sameBytes(bytes.subarray(offset + 30, offset + 30 + localNameLength), nameBytes)) {
      throw structure(name, "the local header disagrees with the central directory");
    }
    spans.push({ name, start: offset, end: start + size });
    files.push([name, bytes.subarray(start, start + size)]);
    if (crc32(bytes.subarray(start, start + size)) !== crc) throw new BundleError("zip.crc", name, "the entry's CRC-32 does not match its bytes");
  }
  if (cursor !== directoryEnd) throw structure(null, "the central directory size disagrees with its records");
  spans.sort((left, right) => left.start - right.start);
  for (let i = 1; i < spans.length; i += 1) {
    if (spans[i]!.start < spans[i - 1]!.end) throw new BundleError("zip.overlap", spans[i]!.name, `the entry overlaps ${spans[i - 1]!.name}`);
  }
  return collectEntries("zip", files, directories, limits);
}
