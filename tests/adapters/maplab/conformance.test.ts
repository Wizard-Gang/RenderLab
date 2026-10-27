import { describe, expect, it } from "vitest";
import { BundleError, readFolder, type BundleErrorCode } from "../../../src/assets";
import { MapLabError, readMapLabExport } from "../../../src/adapters/maplab";
import { FOREST_DIGEST, forestFiles } from "../../assets/helpers";
import { conformanceCases, materialize, type ConformanceCase } from "./mutate";

// RLDR-008: every record of MapLab's bundle conformance suite (fixtures/maplab/conformance/bundle/cases.json), applied
// in memory to the forest export. A case MapLab refuses inside a document must be refused here with MapLab's code, file
// and JSON location. The cases below are the deliberate differences, each listed with its reason so none is skipped
// silently; the last test proves the lists and the suite agree.

/** Records whose edit has no in-memory form: a folder map carries only regular files. The ZIP reader covers them (RLDR-006). */
const CONTAINER_LEVEL: Readonly<Record<string, string>> = {
  "symlink-entry": "a folder map cannot hold a symbolic link; the ZIP reader refuses a link entry as container.special-file (tests/assets/zip.test.ts)",
  "empty-directory": "a folder map cannot hold an empty folder; a ZIP's empty folder entry is refused as container.empty-directory (tests/assets/zip.test.ts)",
  "special-file": "a folder map cannot hold a FIFO; the ZIP reader refuses a special-file entry as container.special-file (tests/assets/zip.test.ts)",
};

/**
 * Records `readBundle` refuses before the MapLab reader runs (specification §8.1 steps 1–6). Its codes are RenderLab's
 * format-neutral ones, so MapLab's `bundle.*` container codes, its JSON limit codes and its manifest-version and
 * external-map codes map to the code and location RenderLab's reader reports.
 */
const BUNDLE_STAGE: Readonly<Record<string, readonly [BundleErrorCode, string]>> = {
  "hidden-entry-path": ["container.path", "maps/.hidden.json"],
  "reserved-device-entry": ["container.path", "maps/con.json"],
  "nested-archive": ["container.nested-archive", "assets/pack.zip"],
  "manifest-missing": ["manifest.missing", "manifest.json"],
  "unlisted-file": ["inventory.unlisted", "notes.txt"],
  "missing-listed-file": ["inventory.missing", "movement/flyer.movement.json"],
  "tampered-size": ["inventory.size", "catalogs/core.catalog.json"],
  "tampered-document-bytes": ["inventory.sha256", "maps/clearing.map.json"],
  "tampered-manifest-digest": ["inventory.sha256", "maps/forest.map.json"],
  "untrusted-bundle-digest": ["bundle.digest", "manifest.json"],
  "manifest-duplicate-key": ["json.duplicate-key", "manifest.json"],
  "manifest-version": ["contract.version", "$.version"],
  "manifest-lists-itself": ["manifest.self", "$.files[1]"],
  "manifest-traversal-path": ["manifest.path", "$.files[0].path"],
  "manifest-case-alias": ["manifest.duplicate", "$.files[3]"],
  "malformed-json": ["json.syntax", "maps/forest.map.json"],
  "invalid-utf8": ["json.utf8", "maps/forest.map.json"],
  "byte-order-mark": ["json.bom", "maps/clearing.map.json"],
  "duplicate-member": ["json.duplicate-key", "maps/forest.map.json"],
  "lone-surrogate": ["json.surrogate", "maps/clearing.map.json"],
  "unsupported-required-contract": ["contract.unsupported", "$.requiredContracts"],
  "external-map-bundle": ["contract.unsupported", "$.requiredContracts"],
  "directory-depth-limit": ["container.path", "d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/d/f.json"],
  "case-alias-entry": ["container.duplicate", "maps/forest.map.json"],
  "duplicate-required-contract": ["contract.duplicate", "$.requiredContracts[5]"],
  "out-of-range-number": ["json.syntax", "maps/forest.map.json"],
  "nesting-depth-limit": ["json.depth", "maps/forest.map.json"],
};

const TYPED_REF = "a typed ref inside a catalog call's params is an engine argument; RenderLab checks its schema, never what it names (§3.1, §8.5)";
const CATALOG = "catalog calls and catalog contents are engine semantics; RenderLab reads the catalog as a schema-checked reference only (§3.1, §8.5)";
const MOVEMENT = "movement abilities are engine semantics; RenderLab reads movement documents as schema- and contract-checked references only (§3.1, §8.5)";

/** Records MapLab refuses only on engine semantics. RenderLab presents these bundles and simulates none of it. */
const ENGINE_SEMANTICS: Readonly<Record<string, string>> = {
  "dangling-typed-ref": TYPED_REF,
  "typed-ref-wrong-kind": TYPED_REF,
  "cross-map-ref-resolves-in-named-map": TYPED_REF,
  "group-ref-resolves-in-named-map": TYPED_REF,
  "undeclared-catalog-call": CATALOG,
  "undeclared-completion-event": CATALOG,
  "completion-event-wrong-version": CATALOG,
  "undeclared-wave": CATALOG,
  "undeclared-respawn-event": CATALOG,
  "undeclared-shake-effect": CATALOG,
  "duplicate-catalog-entry": CATALOG,
  "duplicate-catalog-field": CATALOG,
  "undeclared-ledge-action": MOVEMENT,
  "undeclared-modifier-allowed": MOVEMENT,
  "dangling-profile-param-ref": MOVEMENT,
  "cross-map-ref-outside-closure": MOVEMENT,
  "profile-ref-in-undeclaring-user": MOVEMENT,
  "profile-ref-in-closure-map": MOVEMENT,
  "edge-shape-of-other-body": "which body's shape a foothold edge may use is a collision rule; RenderLab checks the edge names a shape, not its owner (§3.1, §8.5)",
};

const cases = conformanceCases();
const forest = forestFiles();
const applied = cases.filter((record) => !Object.hasOwn(CONTAINER_LEVEL, record.id));

async function outcome(record: ConformanceCase): Promise<unknown> {
  try {
    await readMapLabExport(readFolder(materialize(forest, record)), record.trustedDigest ? { expectDigest: FOREST_DIGEST } : {});
    return { ok: true };
  } catch (error) {
    if (error instanceof MapLabError) return { ok: false, code: error.code, file: error.file, path: error.at };
    if (error instanceof BundleError) return { ok: false, bundle: [error.code, error.at] };
    throw error;
  }
}

function expected(record: ConformanceCase): unknown {
  if (Object.hasOwn(BUNDLE_STAGE, record.id)) return { ok: false, bundle: BUNDLE_STAGE[record.id] };
  if (Object.hasOwn(ENGINE_SEMANTICS, record.id)) return { ok: true };
  return record.expect;
}

describe("MapLab bundle conformance (cases.json)", () => {
  it("lists every deliberate difference against a real case, once, with a reason", () => {
    expect(cases).toHaveLength(104);
    const ids = new Set(cases.map((record) => record.id));
    expect(ids.size).toBe(cases.length);
    const listed = [CONTAINER_LEVEL, BUNDLE_STAGE, ENGINE_SEMANTICS].flatMap((table) => Object.keys(table));
    expect(listed.filter((id) => !ids.has(id))).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
    for (const reason of [...Object.values(CONTAINER_LEVEL), ...Object.values(ENGINE_SEMANTICS)]) expect(reason.length).toBeGreaterThan(20);
    for (const id of Object.keys(ENGINE_SEMANTICS)) expect(cases.find((record) => record.id === id)?.expect.ok).toBe(false);
    for (const record of cases) if (record.expect.ok) expect(listed).not.toContain(record.id);
  });

  it.each(applied.map((record) => [record.id, record] as const))("%s", async (_id, record) => {
    expect(await outcome(record)).toEqual(expected(record));
  });
});
