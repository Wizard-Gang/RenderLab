import { describe, expect, it } from "vitest";
import { BUNDLE_LIMITS, readFolder, readZip, type BundleErrorCode, type BundleLimits } from "../../src/assets";
import { refusal, rigLabFiles, text } from "./helpers";
import { centralRecord, concat, endRecord, localRecord, zipFiles, zipOf, type ZipRecord } from "./zip-writer";

const files = (...names: string[]): ZipRecord[] => names.map((name) => ({ name, data: text(`{"name":"${name}"}`) }));
const limits = (overrides: Partial<BundleLimits>): BundleLimits => ({ ...BUNDLE_LIMITS, ...overrides });
const refusedZip = async (archive: Uint8Array, bounds?: BundleLimits): Promise<{ code: BundleErrorCode; at: string | null }> => {
  const error = await refusal(() => readZip(archive, bounds));
  return { code: error.code, at: error.at };
};
const decoded = (entries: ReadonlyMap<string, Uint8Array>) => [...entries].map(([path, bytes]) => [path, new TextDecoder().decode(bytes)]);

describe("readZip", () => {
  it("reads a STORE ZIP to the same entries as the folder map", () => {
    const rig = rigLabFiles();
    const container = readZip(zipFiles(rig));
    expect(container).toMatchObject({ kind: "zip", root: null });
    expect(decoded(container.entries)).toEqual(decoded(readFolder(rig).entries));
  });

  it("reads from RigLab's riglab-export/ wrapper folder and accepts folder records", () => {
    const archive = zipOf([{ name: "riglab-export/", data: new Uint8Array() }, ...files("riglab-export/manifest.json", "riglab-export/a/b.json")]);
    const container = readZip(archive);
    expect(container.root).toBe("riglab-export");
    expect([...container.entries.keys()]).toEqual(["a/b.json", "manifest.json"]);
  });

  it("bounds entry count, entry size and total size before reading data", async () => {
    expect(await refusedZip(zipOf(files("a.json", "b.json", "c.json")), limits({ entries: 2 }))).toEqual({ code: "container.limit", at: null });
    expect(await refusedZip(zipOf([{ name: "big.json", data: text("12345") }]), limits({ entryBytes: 4 }))).toEqual({ code: "container.limit", at: "big.json" });
    expect(await refusedZip(zipOf(files("a.json", "b.json")), limits({ totalBytes: 20 }))).toEqual({ code: "container.limit", at: "b.json" });
    expect(await refusedZip(zipOf([{ name: "a.json", data: text("{}"), options: { size: 1_000_000 } }]))).toEqual({ code: "zip.structure", at: "a.json" });
  });

  it("reads only STORE: other compression methods and encryption are refused", async () => {
    expect(await refusedZip(zipOf([{ name: "a.json", data: text("{}"), options: { method: 8 } }]))).toEqual({ code: "zip.compression", at: "a.json" });
    expect(await refusedZip(zipOf([{ name: "a.json", data: text("{}"), options: { flags: 0x0801 } }]))).toEqual({ code: "zip.encrypted", at: "a.json" });
    expect(await refusedZip(zipOf([{ name: "a.json", data: text("{}"), options: { compressedSize: 1 } }]))).toEqual({ code: "zip.structure", at: "a.json" });
  });

  it("refuses ZIP64, multi-disk and archives no end record closes", async () => {
    expect(await refusedZip(zipOf(files("a.json"), { count: 0xffff }))).toEqual({ code: "zip.unsupported", at: null });
    expect(await refusedZip(zipOf(files("a.json"), { disk: 1 }))).toEqual({ code: "zip.unsupported", at: null });
    expect(await refusedZip(zipOf([{ name: "a.json", data: text("{}"), options: { size: 0xffffffff } }]))).toEqual({ code: "zip.unsupported", at: "a.json" });
    expect(await refusedZip(text("not a zip archive at all"))).toEqual({ code: "zip.structure", at: null });
    expect(await refusedZip(zipOf(files("a.json")).subarray(0, -1))).toEqual({ code: "zip.structure", at: null });
    expect(await refusedZip(zipOf(files("a.json"), { directorySize: 10 }))).toEqual({ code: "zip.structure", at: "#0" });
  });

  it("checks every entry's CRC-32, local header and offset", async () => {
    expect(await refusedZip(zipOf([{ name: "a.json", data: text("{}"), options: { crc: 1 } }]))).toEqual({ code: "zip.crc", at: "a.json" });
    expect(await refusedZip(zipOf([{ name: "a.json", data: text("{}"), options: { localName: "b.json" } }]))).toEqual({ code: "zip.structure", at: "a.json" });
    expect(await refusedZip(zipOf([{ name: "a.json", data: text("{}"), options: { offset: 9999 } }]))).toEqual({ code: "zip.structure", at: "a.json" });
  });

  it("refuses overlapping entries", async () => {
    const inner = localRecord("b.json", text("{}"));
    const outer = localRecord("a.json", inner);
    const directory = concat(centralRecord("a.json", inner, 0), centralRecord("b.json", text("{}"), 30 + "a.json".length));
    expect(await refusedZip(concat(outer, directory, endRecord(2, directory.length, outer.length)))).toEqual({ code: "zip.overlap", at: "b.json" });
  });

  it("refuses unsafe, duplicate and non-regular entries", async () => {
    const cases: [ZipRecord[], BundleErrorCode, string][] = [
      [files("../evil.json"), "container.path", "../evil.json"],
      [files("/etc/passwd"), "container.path", "/etc/passwd"],
      [files("a\\b.json"), "container.path", "a\\b.json"],
      [files("a.json", "a.json"), "container.duplicate", "a.json"],
      [files("maps/a.json", "MAPS/b.json", "Maps/a.json"), "container.duplicate", "Maps/a.json"],
      [files("maps", "maps/a.json"), "container.conflict", "maps"],
      [[{ name: "link.json", data: text("a.json"), options: { mode: 0o120777 } }], "container.special-file", "link.json"],
      [[{ name: "pipe.json", data: new Uint8Array(), options: { mode: 0o010644 } }], "container.special-file", "pipe.json"],
      [[{ name: "empty/", data: new Uint8Array() }, ...files("a.json")], "container.empty-directory", "empty/"],
      [[{ name: "dir/", data: text("x") }], "zip.structure", "dir/"],
      [[{ name: "é.json", data: text("{}"), options: { flags: 0 } }], "zip.name", "#0"],
      [files("pack.ZIP"), "container.nested-archive", "pack.ZIP"],
    ];
    for (const [records, code, at] of cases) expect(await refusedZip(zipOf(records)), at).toEqual({ code, at });
  });
});
