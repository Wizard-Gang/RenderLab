import { crc32 } from "../../src/assets";

// A test-only STORE ZIP writer, shaped like RigLab's src/export/zip.ts, whose every header field can be overridden so
// tests can build the malformed archives the reader must refuse.

export interface RecordOptions {
  readonly method?: number;
  readonly flags?: number;
  readonly crc?: number;
  /** The uncompressed size the headers declare. */
  readonly size?: number;
  readonly compressedSize?: number;
  /** Unix mode in the external attributes; sets the host to Unix. */
  readonly mode?: number;
  /** A different name in the local header than in the central directory. */
  readonly localName?: string;
  /** Overrides the central record's local-header offset. */
  readonly offset?: number;
}

export interface ZipRecord {
  readonly name: string;
  readonly data: Uint8Array;
  readonly options?: RecordOptions;
}

export interface EndOptions {
  readonly count?: number;
  readonly diskCount?: number;
  readonly disk?: number;
  readonly directorySize?: number;
  readonly directoryOffset?: number;
  readonly comment?: Uint8Array;
}

const encoder = new TextEncoder();
const UTF8 = 1 << 11;

export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function header(size: number) {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

export function localRecord(name: string, data: Uint8Array, options: RecordOptions = {}): Uint8Array {
  const nameBytes = encoder.encode(options.localName ?? name);
  const local = header(30 + nameBytes.length);
  local.view.setUint32(0, 0x04034b50, true);
  local.view.setUint16(4, 20, true);
  local.view.setUint16(6, options.flags ?? UTF8, true);
  local.view.setUint16(8, options.method ?? 0, true);
  local.view.setUint32(14, options.crc ?? crc32(data), true);
  local.view.setUint32(18, options.compressedSize ?? options.size ?? data.length, true);
  local.view.setUint32(22, options.size ?? data.length, true);
  local.view.setUint16(26, nameBytes.length, true);
  local.bytes.set(nameBytes, 30);
  return concat(local.bytes, data);
}

export function centralRecord(name: string, data: Uint8Array, offset: number, options: RecordOptions = {}): Uint8Array {
  const nameBytes = encoder.encode(name);
  const entry = header(46 + nameBytes.length);
  entry.view.setUint32(0, 0x02014b50, true);
  entry.view.setUint16(4, options.mode === undefined ? 20 : (3 << 8) | 20, true);
  entry.view.setUint16(6, 20, true);
  entry.view.setUint16(8, options.flags ?? UTF8, true);
  entry.view.setUint16(10, options.method ?? 0, true);
  entry.view.setUint32(16, options.crc ?? crc32(data), true);
  entry.view.setUint32(20, options.compressedSize ?? options.size ?? data.length, true);
  entry.view.setUint32(24, options.size ?? data.length, true);
  entry.view.setUint16(28, nameBytes.length, true);
  entry.view.setUint32(38, ((options.mode ?? 0) << 16) >>> 0, true);
  entry.view.setUint32(42, options.offset ?? offset, true);
  entry.bytes.set(nameBytes, 46);
  return entry.bytes;
}

export function endRecord(count: number, directorySize: number, directoryOffset: number, options: EndOptions = {}): Uint8Array {
  const comment = options.comment ?? new Uint8Array();
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(4, options.disk ?? 0, true);
  end.view.setUint16(8, options.diskCount ?? options.count ?? count, true);
  end.view.setUint16(10, options.count ?? count, true);
  end.view.setUint32(12, options.directorySize ?? directorySize, true);
  end.view.setUint32(16, options.directoryOffset ?? directoryOffset, true);
  end.view.setUint16(20, comment.length, true);
  return concat(end.bytes, comment);
}

/** Writes the records in order: local records, central directory, end record. */
export function zipOf(records: readonly ZipRecord[], end: EndOptions = {}): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const { name, data, options } of records) {
    const local = localRecord(name, data, options);
    centrals.push(centralRecord(name, data, offset, options));
    locals.push(local);
    offset += local.length;
  }
  const directory = concat(...centrals);
  return concat(...locals, directory, endRecord(records.length, directory.length, offset, end));
}

/** A ZIP of files, optionally under one wrapper folder (RigLab writes `riglab-export/`). */
export function zipFiles(files: Iterable<readonly [string, Uint8Array]>, root?: string): Uint8Array {
  return zipOf([...files].map(([name, data]) => ({ name: root ? `${root}/${name}` : name, data })));
}
