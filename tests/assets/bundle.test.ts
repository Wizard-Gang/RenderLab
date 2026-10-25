import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CompatibilityError, contentId, MANIFEST_VERSIONS, MAPLAB_FIELDS, MAPLAB_ROLES, pathProblem, readBundle, readFolder, readZip,
  ResourceRegistry, type BundleErrorCode,
} from "../../src/assets";
import { EXPORT_SCHEMA, editManifest, FOREST_DIGEST, FOREST_SUPPORT, forestFiles, refusal, refused, rigLabFiles, sha256, text } from "./helpers";
import { concat, zipFiles } from "./zip-writer";

const forest = forestFiles();
const FOREST = "maps/forest.map.json";
const copy = (change: (files: Map<string, Uint8Array>) => void) => {
  const files = new Map(forest);
  change(files);
  return files;
};
const flipped = (bytes: Uint8Array) => {
  const out = bytes.slice();
  out[out.length >> 1]! ^= 1;
  return out;
};
const raw = new TextDecoder().decode(forest.get("manifest.json"));

describe("readBundle on MapLab's forest export", () => {
  it("loads the locked fixture from a folder map and from a STORE ZIP", async () => {
    const bundle = await readBundle(readFolder(forest), { support: FOREST_SUPPORT });
    expect(bundle).toMatchObject({ format: "maplab.export", version: 1, digest: FOREST_DIGEST, digestExpected: false });
    expect(bundle.container).toEqual({ kind: "folder", root: null });
    expect(bundle.publisher).toEqual({ claimed: "MapLab 0.0.0-r1-spec", verified: false });
    expect(bundle.compatibility).toMatchObject({ compatible: true, unsupported: [] });
    expect(bundle.compatibility.required).toHaveLength(8);
    expect([...bundle.files.keys()]).toEqual([...forest.keys()].filter((path) => path !== "manifest.json"));
    expect(bundle.files.get(FOREST)).toMatchObject({ role: "authored", id: `sha256:${sha256(forest.get(FOREST)!)}` });

    const zipped = await readBundle(readZip(zipFiles(forest)), { support: FOREST_SUPPORT, expectDigest: FOREST_DIGEST });
    expect(zipped.container).toEqual({ kind: "zip", root: null });
    expect(zipped.digestExpected).toBe(true);
    expect([...zipped.files.values()].map((file) => file.id)).toEqual([...bundle.files.values()].map((file) => file.id));
  });

  const matrix: [string, () => Map<string, Uint8Array>, BundleErrorCode, string | null][] = [
    ["corrupt bytes", () => copy((f) => f.set(FOREST, flipped(forest.get(FOREST)!))), "inventory.sha256", FOREST],
    ["an entry of the wrong size", () => copy((f) => f.set(FOREST, concat(forest.get(FOREST)!, text(" ")))), "inventory.size", FOREST],
    ["a wrong listed size", () => editManifest(forest, (m) => { m.files[0].bytes += 1; }), "inventory.size", "catalogs/core.catalog.json"],
    ["a wrong listed digest", () => editManifest(forest, (m) => { m.files[2].sha256 = "0".repeat(64); }), "inventory.sha256", FOREST],
    ["an unlisted entry", () => copy((f) => f.set("notes.txt", text("untracked"))), "inventory.unlisted", "notes.txt"],
    ["a missing listed entry", () => copy((f) => f.delete("movement/flyer.movement.json")), "inventory.missing", "movement/flyer.movement.json"],
    ["a missing manifest", () => copy((f) => f.delete("manifest.json")), "manifest.missing", "manifest.json"],
    ["a path listed twice", () => editManifest(forest, (m) => { m.files.push({ ...m.files[0] }); }), "manifest.duplicate", "$.files[7]"],
    ["a listed case alias", () => editManifest(forest, (m) => { m.files.push({ ...m.files[2], path: "MAPS/forest.map.json" }); }), "manifest.duplicate", "$.files[7]"],
    ["a manifest listing itself", () => editManifest(forest, (m) => { m.files.push({ ...m.files[0], path: "manifest.json" }); }), "manifest.self", "$.files[7]"],
    ["a traversal listed path", () => editManifest(forest, (m) => { m.files[0].path = "../catalogs/core.catalog.json"; }), "manifest.path", "$.files[0].path"],
    ["an absolute listed path", () => editManifest(forest, (m) => { m.files[0].path = "/etc/passwd"; }), "manifest.path", "$.files[0].path"],
    ["an unknown manifest field", () => editManifest(forest, (m) => { m.script = "run()"; }), "manifest.field", "$.script"],
    ["a missing manifest field", () => editManifest(forest, (m) => { delete m.files; }), "manifest.field", "$.files"],
    ["an unknown file role", () => editManifest(forest, (m) => { m.files[0].role = "script"; }), "manifest.field", "$.files[0].role"],
    ["an unknown format", () => editManifest(forest, (m) => { m.format = "maplab.world"; }), "manifest.format", "$.format"],
    ["a newer manifest version", () => editManifest(forest, (m) => { m.version = 2; }), "contract.version", "$.version"],
    ["an older manifest version", () => editManifest(forest, (m) => { m.version = 0; }), "contract.version", "$.version"],
    ["a duplicate required contract", () => editManifest(forest, (m) => { m.requiredContracts.push({ key: "maplab.map", version: 1 }); }), "contract.duplicate", "$.requiredContracts[8]"],
    ["an unknown required feature", () => editManifest(forest, (m) => { m.requiredContracts.push({ key: "maplab.grapple", version: 1 }); }), "contract.unsupported", "$.requiredContracts"],
    ["an unsupported contract version", () => editManifest(forest, (m) => { m.requiredContracts[4].version = 2; }), "contract.unsupported", "$.requiredContracts"],
    ["linked external map bundles", () => editManifest(forest, (m) => { m.externalMaps.push({ mapId: "map.cave", bundleSha256: "1".repeat(64) }); }), "contract.unsupported", "$.requiredContracts"],
    ["malformed manifest JSON", () => copy((f) => f.set("manifest.json", text('{"format":'))), "json.syntax", "manifest.json"],
    ["a duplicate manifest member", () => copy((f) => f.set("manifest.json", text(raw.replace('"entryMapId":"map.forest",', '"entryMapId":"map.forest","entryMapId":"map.clearing",')))), "json.duplicate-key", "manifest.json"],
    ["a hidden entry path", () => copy((f) => f.set("maps/.hidden.json", text("{}"))), "container.path", "maps/.hidden.json"],
    ["a reserved device name", () => copy((f) => f.set("maps/con.json", text("{}"))), "container.path", "maps/con.json"],
    ["a case-alias entry", () => copy((f) => f.set("maps/Forest.map.json", forest.get(FOREST)!)), "container.duplicate", "maps/Forest.map.json"],
    ["a nested archive", () => copy((f) => f.set("assets/pack.zip", text("PK"))), "container.nested-archive", "assets/pack.zip"],
  ];

  it.each(matrix)("refuses %s", async (_name, files, code, at) => {
    expect(await refused(files())).toEqual({ code, at });
  });

  it("reports every unmet contract with what is supported instead", async () => {
    const files = editManifest(forest, (m) => {
      m.requiredContracts[4].version = 2;
      m.requiredContracts.push({ key: "maplab.grapple", version: 1 });
    });
    const error = await refusal(() => readBundle(readFolder(files), { support: FOREST_SUPPORT }));
    expect(error).toBeInstanceOf(CompatibilityError);
    const { report } = error as CompatibilityError;
    expect(report.compatible).toBe(false);
    expect(report.unsupported.map(({ key, version, supported }) => ({ key, version, supported }))).toEqual([
      { key: "maplab.map", version: 2, supported: [1] },
      { key: "maplab.grapple", version: 1, supported: [] },
    ]);
    expect(report.unsupported[0]!.reason).toMatch(/maplab\.map v2 is required, but this reader supports maplab\.map v1; re-export/);
    expect(report.unsupported[1]!.reason).toMatch(/supports no version of maplab\.grapple/);
    expect(error.message).toContain(report.unsupported[1]!.reason);
    const none = await refusal(() => readBundle(readFolder(forest), { support: new Map() }));
    expect((none as CompatibilityError).report.unsupported).toHaveLength(8);
  });

  it("treats a correct digest as integrity, never as publisher identity", async () => {
    // A forger who edits the manifest and re-hashes nothing else still has a self-consistent bundle.
    const forged = editManifest(forest, (m) => { m.generator.version = "0.0.1-tampered"; });
    const bundle = await readBundle(readFolder(forged), { support: FOREST_SUPPORT });
    expect(bundle.publisher).toEqual({ claimed: "MapLab 0.0.1-tampered", verified: false });
    expect(bundle.digest).not.toBe(FOREST_DIGEST);
    // Only a digest from a trusted channel, outside the bundle, ties it to what was published.
    expect(await refused(forged, FOREST_SUPPORT, FOREST_DIGEST)).toEqual({ code: "bundle.digest", at: "manifest.json" });
    const pinned = await readBundle(readFolder(forest), { support: FOREST_SUPPORT, expectDigest: FOREST_DIGEST });
    expect(pinned).toMatchObject({ digestExpected: true, publisher: { verified: false } });
  });

  it("mirrors MapLab's maplab.export v1 schema field for field", () => {
    const schema = JSON.parse(readFileSync(EXPORT_SCHEMA, "utf8"));
    expect([...MAPLAB_FIELDS].sort()).toEqual([...schema.required].sort());
    expect([...MAPLAB_FIELDS].sort()).toEqual(Object.keys(schema.properties).sort());
    expect(schema.additionalProperties).toBe(false);
    expect(MANIFEST_VERSIONS["maplab.export"]).toEqual([schema.properties.version.const]);
    expect([...MAPLAB_ROLES]).toEqual(schema.properties.files.items.properties.role.enum);
    expect(schema.properties.files.items.required).toEqual(["path", "bytes", "sha256", "role"]);
    const grammar = new RegExp(schema.$defs.path.pattern);
    for (const path of ["maps/forest.map.json", "a", "x_1/y-2.png", "../x", ".hidden", "a//b", "x.", "-x", "a\\b", "/abs"]) {
      expect(pathProblem(path) === null, path).toBe(grammar.test(path));
    }
  });
});

describe("readBundle on RigLab's export shape", () => {
  it("loads a riglab-export STORE ZIP from its wrapper folder, pinned by SHA-256 alone", async () => {
    const bundle = await readBundle(readZip(zipFiles(rigLabFiles({ baked: true }), "riglab-export")), { support: new Map() });
    expect(bundle).toMatchObject({ format: "riglab.export", version: 1, publisher: { claimed: "RigLab test", verified: false } });
    expect(bundle.container).toEqual({ kind: "zip", root: "riglab-export" });
    expect([...bundle.files.values()].map(({ path, role }) => [path, role])).toEqual([
      ["chibi.rig.json", "rig"], ["animations/idle.anim.json", "animation"], ["weapons/sword.weapon.json", "weapon"], ["baked/idle.baked.json", "baked"],
    ]);
    expect(bundle.manifest.files.every((file) => file.bytes === null)).toBe(true);
    expect(bundle.compatibility).toEqual({ compatible: true, required: [], unsupported: [] });
  });

  const rig = rigLabFiles();
  const rigMatrix: [string, () => Map<string, Uint8Array>, BundleErrorCode, string][] = [
    ["corrupt bytes", () => new Map(rig).set("chibi.rig.json", flipped(rig.get("chibi.rig.json")!)), "inventory.sha256", "chibi.rig.json"],
    ["an unlisted entry", () => new Map(rig).set("animations/run.anim.json", text("{}")), "inventory.unlisted", "animations/run.anim.json"],
    ["a newer export version", () => editManifest(rig, (m) => { m.version = 2; }), "contract.version", "$.version"],
    ["an unknown field", () => editManifest(rig, (m) => { m.skins = []; }), "manifest.field", "$.skins"],
    ["a missing rig", () => editManifest(rig, (m) => { delete m.rig; }), "manifest.field", "$.rig"],
    ["an unsafe listed file", () => editManifest(rig, (m) => { m.weapons[0].file = "../sword.json"; }), "manifest.path", "$.weapons[0].file"],
  ];

  it.each(rigMatrix)("refuses %s", async (_name, files, code, at) => {
    expect(await refused(files(), new Map())).toEqual({ code, at });
  });
});

describe("content identity", () => {
  it("gives equal bytes one ID across bundles and paths, so they load once", async () => {
    const moved = editManifest(copy((f) => { f.delete(FOREST); f.set("maps/woods.map.json", forest.get(FOREST)!); }), (m) => {
      m.files[2].path = "maps/woods.map.json";
      m.documents[2].path = "maps/woods.map.json";
    });
    const [first, second] = await Promise.all([forest, moved].map((files) => readBundle(readFolder(files), { support: FOREST_SUPPORT })));
    const original = first!.files.get(FOREST)!;
    expect(second!.files.get("maps/woods.map.json")!.id).toBe(original.id);
    expect(original.id).toBe(contentId(original.sha256));

    let loads = 0;
    const registry = new ResourceRegistry<Uint8Array>(() => undefined);
    const leases = [first!.files.get(FOREST)!, second!.files.get("maps/woods.map.json")!].map((file) =>
      registry.acquire(file.id, async () => { loads += 1; return file.bytes; }));
    await Promise.all(leases.map((lease) => lease.ready));
    expect(loads).toBe(1);
    expect(registry.refs(original.id)).toBe(2);
    expect(() => contentId("not-a-digest")).toThrow(TypeError);
  });
});
