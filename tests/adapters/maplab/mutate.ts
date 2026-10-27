import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A port of MapLab's tests/consumer/mutate.mjs (pinned at the commit fixtures/provenance.json records) that applies one
// inert conformance edit record to an in-memory copy of a bundle. JSON edits re-encode the edited file as RFC 8785 and
// re-hash it in the manifest unless the record says `"rehash": false`, so each record isolates exactly one defect.
// Symlinks, empty directories and FIFOs have no in-memory form; those records are container-level and never applied.

export const CASES_FILE = fileURLToPath(new URL("../../../fixtures/maplab/conformance/bundle/cases.json", import.meta.url));
const SCHEMA_DIR = fileURLToPath(new URL("../../../fixtures/maplab/schemas/", import.meta.url));

type Json = any;

export interface CaseEdit {
  readonly [key: string]: Json;
}

export interface ConformanceCase {
  readonly id: string;
  readonly group: string;
  readonly edits: readonly CaseEdit[];
  readonly expect: { readonly ok: true } | { readonly ok: false; readonly code: string; readonly file: string | null; readonly path: string };
  readonly trustedDigest?: boolean;
  readonly requiresCaseSensitiveFs?: boolean;
}

export function conformanceCases(): readonly ConformanceCase[] {
  return (JSON.parse(readFileSync(CASES_FILE, "utf8")) as { cases: ConformanceCase[] }).cases;
}

// The helper's own RFC 8785 encoder for ASCII/BMP fixture data, independent of the reader's.
const jcs = (v: Json): string => (Array.isArray(v) ? `[${v.map(jcs).join(",")}]`
  : v !== null && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(",")}}` : JSON.stringify(v));
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const tokens = (pointer: string): string[] => pointer.split("/").slice(1).map((t) => t.replaceAll("~1", "/").replaceAll("~0", "~"));
const utf8 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));

function edit(value: Json, pointer: string, op: string, replacement: Json): void {
  const keys = tokens(pointer);
  const last = keys.pop()!;
  const parent = keys.reduce((node, k) => node[Array.isArray(node) ? Number(k) : k], value);
  if (op === "set") parent[Array.isArray(parent) ? Number(last) : last] = replacement;
  else if (op === "remove") {
    if (Array.isArray(parent)) parent.splice(Number(last), 1);
    else delete parent[last];
  } else if (op === "append") parent[last].push(replacement);
  else if (op === "swap") {
    const list = parent[last];
    [list[replacement[0]], list[replacement[1]]] = [list[replacement[1]], list[replacement[0]]];
  } else if (op === "insertSorted") {
    parent[last].push(replacement);
    parent[last].sort((a: Json, b: Json) => (jcs(a.key ?? a.path ?? a.id) < jcs(b.key ?? b.path ?? b.id) ? -1 : 1));
  }
}

/** A copy of `source` with `record.edits` applied in order. */
export function materialize(source: ReadonlyMap<string, Uint8Array>, record: ConformanceCase): Map<string, Uint8Array> {
  const files = new Map(source);
  const read = (path: string): Uint8Array => {
    const bytes = files.get(path);
    if (!bytes) throw new Error(`${record.id}: ${path} is not in the bundle`);
    return bytes;
  };
  const parse = (path: string): Json => JSON.parse(Buffer.from(read(path)).toString("utf8"));
  const writeManifest = (manifest: Json) => files.set("manifest.json", utf8(jcs(manifest)));
  const rehash = (path: string) => {
    const manifest = parse("manifest.json");
    const file = manifest.files.find((x: Json) => x.path === path);
    if (file) {
      const bytes = read(path);
      file.bytes = bytes.length;
      file.sha256 = sha(bytes);
      writeManifest(manifest);
    }
  };
  for (const e of record.edits) {
    if (e.file !== undefined) {
      const op = ["set", "remove", "append", "insertSorted", "swap"].find((k) => e[k] !== undefined);
      if (op) {
        const value = parse(e.file);
        edit(value, e[op], op, e.value);
        files.set(e.file, utf8(e.encoding === "pretty" ? JSON.stringify(value, null, 2) : jcs(value)));
      } else if (e.replace !== undefined) {
        const text = Buffer.from(read(e.file)).toString("latin1");
        if (!text.includes(e.replace)) throw new Error(`${record.id}: ${e.replace} not found in ${e.file}`);
        const withBytes = e.withHex !== undefined ? Buffer.from(e.withHex, "hex").toString("latin1") : Buffer.from(e.with, "utf8").toString("latin1");
        files.set(e.file, new Uint8Array(Buffer.from(text.replace(e.replace, withBytes), "latin1")));
      } else if (e.truncate !== undefined) {
        const bytes = read(e.file);
        files.set(e.file, bytes.subarray(0, bytes.length - e.truncate));
      } else if (e.prependHex !== undefined) {
        files.set(e.file, new Uint8Array(Buffer.concat([Buffer.from(e.prependHex, "hex"), read(e.file)])));
      } else if (e.reencode !== undefined) {
        const value = parse(e.file);
        files.set(e.file, utf8(e.reencode === "pretty" ? JSON.stringify(value, null, 2) : jcs(value)));
      } else throw new Error(`${record.id}: unknown file edit`);
      if (e.file !== "manifest.json" && e.rehash !== false) rehash(e.file);
    } else if (e.add !== undefined) {
      const bytes = e.copyOf !== undefined ? read(e.copyOf)
        : e.pinnedSchema !== undefined ? new Uint8Array(readFileSync(`${SCHEMA_DIR}${e.pinnedSchema}`)) : utf8(e.text ?? "");
      files.set(e.add, bytes);
      if (e.role) {
        const manifest = parse("manifest.json");
        manifest.files.push({ path: e.add, bytes: bytes.length, sha256: sha(bytes), role: e.role });
        manifest.files.sort((a: Json, b: Json) => (a.path < b.path ? -1 : 1));
        if (e.document) {
          manifest.documents.push({ ...e.document, path: e.add });
          manifest.documents.sort((a: Json, b: Json) => (a.id < b.id ? -1 : 1));
        }
        writeManifest(manifest);
      }
    } else if (e.delete !== undefined) {
      files.delete(e.delete);
      if (e.unlist) {
        const manifest = parse("manifest.json");
        manifest.files = manifest.files.filter((f: Json) => f.path !== e.delete);
        manifest.documents = manifest.documents.filter((d: Json) => d.path !== e.delete);
        writeManifest(manifest);
      }
    } else throw new Error(`${record.id}: ${Object.keys(e).join("+")} has no in-memory form; list the case as container-level`);
  }
  return new Map([...files].sort(([left], [right]) => (left < right ? -1 : 1)));
}
