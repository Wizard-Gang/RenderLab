import { describe, expect, it } from "vitest";
import { BUNDLE_LIMITS, pathProblem, readFolder, type BundleLimits } from "../../src/assets";
import { refusal, text } from "./helpers";

const entry = (path: string, value = "{}") => [path, text(value)] as const;
const limits = (overrides: Partial<BundleLimits>): BundleLimits => ({ ...BUNDLE_LIMITS, ...overrides });
const refusedFolder = async (entries: (readonly [string, Uint8Array])[], bounds?: BundleLimits) => {
  const error = await refusal(() => readFolder(entries, bounds));
  return { code: error.code, at: error.at };
};

describe("pathProblem", () => {
  it.each(["a.json", "maps/forest.map.json", "x_1/y-2.png", "_/a", `${"d/".repeat(16)}f.json`, "a".repeat(240)])("accepts %s", (path) => {
    expect(pathProblem(path)).toBeNull();
  });

  it.each<[string, RegExp]>([
    ["", /empty/], ["/abs.json", /segment ""/], ["a//b", /segment ""/], ["../x", /segment "\.\."/], ["./x", /segment "\."/],
    ["a/../b", /segment "\.\."/], [".hidden", /segment "\.hidden"/], ["a\\b", /not a portable/], ["x.", /segment "x\."/],
    ["-x", /segment "-x"/], ["a b", /not a portable/], ["é.json", /not a portable/], ["maps/con.json", /reserved device name/],
    ["LPT1", /reserved device name/], ["a".repeat(241), /longer than 240/], [`${"d/".repeat(17)}f.json`, /more than 16 folders/],
  ])("refuses %j", (path, problem) => {
    expect(pathProblem(path)).toMatch(problem);
  });
});

describe("readFolder", () => {
  it("returns entries in code-unit path order", () => {
    const container = readFolder([entry("b.json"), entry("A.json"), entry("a/z.json")]);
    expect(container).toMatchObject({ kind: "folder", root: null });
    expect([...container.entries.keys()]).toEqual(["A.json", "a/z.json", "b.json"]);
  });

  it("refuses repeated paths, case aliases and file/folder conflicts", async () => {
    expect(await refusedFolder([entry("a.json"), entry("a.json")])).toEqual({ code: "container.duplicate", at: "a.json" });
    expect(await refusedFolder([entry("a.json"), entry("A.JSON")])).toEqual({ code: "container.duplicate", at: "A.JSON" });
    expect(await refusedFolder([entry("maps/a.json"), entry("maps")])).toEqual({ code: "container.conflict", at: "maps" });
  });

  it("bounds entries and bytes", async () => {
    expect(await refusedFolder([entry("a.json"), entry("b.json")], limits({ entries: 1 }))).toEqual({ code: "container.limit", at: "b.json" });
    expect(await refusedFolder([entry("a.json", "123")], limits({ entryBytes: 2 }))).toEqual({ code: "container.limit", at: "a.json" });
    expect(await refusedFolder([entry("a.json", "12"), entry("b.json", "12")], limits({ totalBytes: 3 }))).toEqual({ code: "container.limit", at: "b.json" });
  });

  it("finds a single wrapper folder only when it holds the manifest and no manifest sits at the root", () => {
    expect(readFolder([entry("riglab-export/manifest.json"), entry("riglab-export/x.json")]).root).toBe("riglab-export");
    expect(readFolder([entry("manifest.json"), entry("riglab-export/manifest.json")]).root).toBeNull();
    expect(readFolder([entry("one/manifest.json"), entry("two/x.json")]).root).toBeNull();
    expect(readFolder([entry("one/x.json")]).root).toBeNull();
  });
});
