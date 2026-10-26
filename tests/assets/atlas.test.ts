import { describe, expect, it } from "vitest";
import {
  ATLAS_COMPILER, buildAtlas, CompileError, compileAtlas, pack, prepareSvg, SVG_LIMITS, validateAtlas,
  type Atlas, type AtlasPage, type AtlasRegion, type AtlasSettings, type CompileErrorCode, type Raster, type Rasterizer,
} from "../../src/assets";
import { sha256, text } from "./helpers";

// A stand-in rasterizer: each source's root `fill` gives its red and green channels, and blue and alpha encode the
// pixel's own coordinates, so every pixel of every source is distinguishable and any bleed or misplacement shows.
const fakeRasterizer: Rasterizer = {
  identity: { name: "test-pattern", version: "1", environment: "vitest" },
  rasterize: async ({ svg, width, height }) => {
    const fill = /\sfill="#([0-9a-f]{2})([0-9a-f]{2})[0-9a-f]{2}"/.exec(svg)!;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) data.set([parseInt(fill[1], 16), parseInt(fill[2], 16), x, 128 + y], (y * width + x) * 4);
    }
    return { width, height, data };
  },
};

const svg = (width: number, height: number, fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" fill="${fill}"><rect width="${width}" height="${height}"/></svg>`;
const SOURCES = [
  { id: "rig/torso", svg: svg(12, 16, "#ff004d") },
  { id: "rig/head", svg: svg(8, 8, "#29adff") },
  { id: "rig/arm.left", svg: svg(4, 12, "#00e436") },
  { id: "rig/arm.right", svg: svg(4, 12, "#ffa300") },
  { id: "map/tile:grass", svg: svg(16, 16, "#008751") },
  { id: "map/tile:water", svg: svg(16, 16, "#1d2b53") },
];
const SETTINGS: AtlasSettings = { scale: 1, maxPageSize: 256, padding: 1, extrude: 1, filter: "nearest" };

const refusal = (run: () => unknown): [CompileErrorCode, string | null] | null => {
  try {
    run();
  } catch (error) {
    if (error instanceof CompileError) return [error.code, error.at];
    throw error;
  }
  return null;
};
const rejected = (run: Promise<unknown>) => run.then(() => null, (error) => error instanceof CompileError ? [error.code, error.at] : Promise.reject(error));

const texel = (page: AtlasPage, x: number, y: number) => [...page.data.subarray((y * page.width + x) * 4, (y * page.width + x) * 4 + 4)];
const rasterPixel = (raster: Raster, x: number, y: number) => [...raster.data.subarray((y * raster.width + x) * 4, (y * raster.width + x) * 4 + 4)];
const clamp = (value: number, max: number) => Math.min(max - 1, Math.max(0, value));
const nearest = (page: AtlasPage, u: number, v: number) => texel(page, clamp(Math.floor(u * page.width), page.width), clamp(Math.floor(v * page.height), page.height));
/** Bilinear filtering as a GPU does it: texel centres at half-integers, clamped to the page edge. */
function linear(page: AtlasPage, u: number, v: number): number[] {
  const px = u * page.width - 0.5;
  const py = v * page.height - 0.5;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const at = (x: number, y: number) => texel(page, clamp(x, page.width), clamp(y, page.height));
  return [0, 1, 2, 3].map((channel) =>
    at(x0, y0)[channel] * (1 - fx) * (1 - fy) + at(x0 + 1, y0)[channel] * fx * (1 - fy)
    + at(x0, y0 + 1)[channel] * (1 - fx) * fy + at(x0 + 1, y0 + 1)[channel] * fx * fy);
}

async function rasters(scale = 1) {
  const out = new Map<string, Raster>();
  for (const source of SOURCES) {
    const prepared = prepareSvg(source.svg, scale, source.id);
    out.set(source.id, await fakeRasterizer.rasterize(prepared));
  }
  return out;
}

describe("pack", () => {
  const items = SOURCES.map((source, index) => ({ id: source.id, width: 4 + index * 3, height: 20 - index * 2 }));

  it("gives the same packing whatever order the items arrive in", () => {
    const expected = pack(items, SETTINGS);
    for (const order of [[...items].reverse(), [items[3], items[0], items[5], items[1], items[4], items[2]]]) {
      expect(pack(order, SETTINGS)).toEqual(expected);
    }
    expect(expected.placements.map((placement) => placement.id)).toEqual(SOURCES.map((source) => source.id).sort());
  });

  it("breaks ties between equal sizes by ID, not by arrival order", () => {
    const same = ["c", "a", "b"].map((id) => ({ id, width: 8, height: 8 }));
    const placements = pack(same, SETTINGS).placements;
    expect(placements.map(({ id, x }) => [id, x])).toEqual([["a", 2], ["b", 14], ["c", 26]]);
  });

  it("sizes pages to the next power of two and spills onto further pages within the limit", () => {
    const tiles = ["a", "b", "c", "d", "e"].map((id) => ({ id, width: 30, height: 30 }));
    const packing = pack(tiles, { maxPageSize: 64, padding: 0, extrude: 1 });
    expect(packing.pages).toEqual([{ width: 64, height: 64 }, { width: 32, height: 32 }]);
    expect(packing.placements.map(({ id, page, x, y }) => [id, page, x, y]))
      .toEqual([["a", 0, 1, 1], ["b", 0, 33, 1], ["c", 0, 1, 33], ["d", 0, 33, 33], ["e", 1, 1, 1]]);
  });

  it("refuses an image that cannot fit one page with its extrusion and padding", () => {
    expect(refusal(() => pack([{ id: "huge", width: 63, height: 8 }], { maxPageSize: 64, padding: 0, extrude: 1 })))
      .toEqual(["atlas.too-large", "huge"]);
    expect(refusal(() => pack([{ id: "fits", width: 62, height: 62 }], { maxPageSize: 64, padding: 0, extrude: 1 }))).toBeNull();
  });
});

describe("buildAtlas and compileAtlas", () => {
  it("copies every source exactly under UVs that are its rectangle over the page size", async () => {
    const { atlas } = await compileAtlas(SOURCES, SETTINGS, fakeRasterizer);
    const sources = await rasters();
    expect(validateAtlas(atlas)).toEqual([]);
    expect(atlas.regions.map((region) => region.id)).toEqual(SOURCES.map((source) => source.id).sort());
    for (const region of atlas.regions) {
      const page = atlas.pages[region.page];
      const raster = sources.get(region.id)!;
      expect([region.width, region.height]).toEqual([raster.width, raster.height]);
      expect([region.u0, region.v0, region.u1, region.v1])
        .toEqual([region.x / page.width, region.y / page.height, (region.x + region.width) / page.width, (region.y + region.height) / page.height]);
      for (let y = 0; y < raster.height; y += 1) {
        for (let x = 0; x < raster.width; x += 1) {
          const u = region.u0 + (x + 0.5) / page.width;
          const v = region.v0 + (y + 0.5) / page.height;
          expect(nearest(page, u, v)).toEqual(rasterPixel(raster, x, y));
          expect(linear(page, u, v)).toEqual(rasterPixel(raster, x, y));
        }
      }
    }
  });

  it("extrudes edge pixels outward and leaves the padding beyond them transparent", async () => {
    const { atlas } = await compileAtlas(SOURCES, { ...SETTINGS, padding: 2, extrude: 2 }, fakeRasterizer);
    const sources = await rasters();
    for (const region of atlas.regions) {
      const page = atlas.pages[region.page];
      const raster = sources.get(region.id)!;
      for (let y = -4; y < region.height + 4; y += 1) {
        for (let x = -4; x < region.width + 4; x += 1) {
          const outside = Math.max(-x, x - region.width + 1, -y, y - region.height + 1);
          if (outside <= 0) continue;
          const expected = outside <= 2 ? rasterPixel(raster, clamp(x, raster.width), clamp(y, raster.height)) : [0, 0, 0, 0];
          expect(texel(page, region.x + x, region.y + y)).toEqual(expected);
        }
      }
    }
  });

  it("samples only a source's own pixels at its UV edges, under nearest and linear filtering", async () => {
    const sources = await rasters();
    const entries = [...sources].map(([id, raster]) => ({ id, raster }));
    for (const filter of ["nearest", "linear"] as const) {
      const atlas = buildAtlas(entries, { maxPageSize: 256, padding: 1, extrude: 1, filter });
      const sample = filter === "nearest" ? nearest : linear;
      for (const region of atlas.regions) {
        const page = atlas.pages[region.page];
        const raster = sources.get(region.id)!;
        const right = raster.width - 1;
        const bottom = raster.height - 1;
        expect(sample(page, region.u0, region.v0)).toEqual(rasterPixel(raster, 0, 0));
        expect(sample(page, region.u1, region.v0)).toEqual(rasterPixel(raster, right, 0));
        expect(sample(page, region.u0, region.v1)).toEqual(rasterPixel(raster, 0, bottom));
        expect(sample(page, region.u1, region.v1)).toEqual(rasterPixel(raster, right, bottom));
      }
    }
    // Without extrusion the same edge samples read the transparent padding: the check above has teeth.
    const bare = buildAtlas(entries, { maxPageSize: 256, padding: 1, extrude: 0, filter: "linear" });
    const region = bare.regions[0];
    expect(linear(bare.pages[region.page], region.u0, region.v0)).not.toEqual(rasterPixel(sources.get(region.id)!, 0, 0));
    expect(nearest(bare.pages[region.page], region.u1, region.v1)).toEqual([0, 0, 0, 0]);
  });

  it("gives byte-identical pages and manifests for the same inputs in any order", async () => {
    const first = await compileAtlas(SOURCES, SETTINGS, fakeRasterizer);
    const second = await compileAtlas([...SOURCES].reverse(), SETTINGS, fakeRasterizer);
    expect(second.manifest).toEqual(first.manifest);
    expect(second.atlas.pages.map((page) => page.data)).toEqual(first.atlas.pages.map((page) => page.data));
    const changed = await compileAtlas(SOURCES, { ...SETTINGS, padding: 2 }, fakeRasterizer);
    expect(changed.manifest.pages[0].sha256).not.toBe(first.manifest.pages[0].sha256);
  });

  it("records identity, settings, sizes, hashes and the required texture size in the manifest", async () => {
    const { atlas, manifest } = await compileAtlas(SOURCES, { ...SETTINGS, scale: 2 }, fakeRasterizer);
    expect(manifest).toMatchObject({
      format: "renderlab.atlas", version: 1, compiler: ATLAS_COMPILER, rasterizer: fakeRasterizer.identity,
      settings: { ...SETTINGS, scale: 2 }, regions: atlas.regions,
    });
    expect(manifest.sources).toEqual([...SOURCES].sort((a, b) => (a.id < b.id ? -1 : 1)).map((source) => {
      const size = /width="(\d+)" height="(\d+)"/.exec(source.svg)!;
      return { id: source.id, sha256: sha256(text(source.svg)), width: Number(size[1]), height: Number(size[2]) };
    }));
    expect(manifest.pages).toEqual(atlas.pages.map((page) => ({
      index: page.index, width: page.width, height: page.height, format: "rgba8unorm", alpha: "straight",
      bytes: page.width * page.height * 4, sha256: sha256(page.data),
    })));
    expect(atlas.regions.find((region) => region.id === "rig/torso")).toMatchObject({ width: 24, height: 32 });
    expect(manifest.requiredFeatures.maxTextureSize).toBe(Math.max(...atlas.pages.flatMap((page) => [page.width, page.height])));
  });

  it("spreads sources over several pages when one page cannot hold them", async () => {
    const { atlas, manifest } = await compileAtlas(SOURCES, { ...SETTINGS, maxPageSize: 32 }, fakeRasterizer);
    expect(atlas.pages.length).toBeGreaterThan(1);
    expect(validateAtlas(atlas)).toEqual([]);
    expect(manifest.requiredFeatures.maxTextureSize).toBeLessThanOrEqual(32);
  });

  it("refuses bad IDs, duplicates, settings, oversized sources and misshapen rasters", async () => {
    const one = (id: string) => [{ id, svg: svg(4, 4, "#ffffff") }];
    expect(await rejected(compileAtlas(one(""), SETTINGS, fakeRasterizer))).toEqual(["atlas.id", ""]);
    expect(await rejected(compileAtlas(one("-leading"), SETTINGS, fakeRasterizer))).toEqual(["atlas.id", "-leading"]);
    expect(await rejected(compileAtlas(one("has space"), SETTINGS, fakeRasterizer))).toEqual(["atlas.id", "has space"]);
    expect(await rejected(compileAtlas([...one("twin"), ...one("twin")], SETTINGS, fakeRasterizer))).toEqual(["atlas.duplicate", "twin"]);
    for (const [change, at] of [
      [{ maxPageSize: 8 }, "maxPageSize"], [{ maxPageSize: 100.5 }, "maxPageSize"], [{ padding: -1 }, "padding"],
      [{ extrude: 1.5 }, "extrude"], [{ filter: "cubic" }, "filter"], [{ filter: "linear", extrude: 0 }, "extrude"], [{ scale: 0 }, "scale"],
    ] as const) {
      expect(await rejected(compileAtlas(one("a"), { ...SETTINGS, ...change } as AtlasSettings, fakeRasterizer))).toEqual(["atlas.settings", at]);
    }
    expect(await rejected(compileAtlas([{ id: "big", svg: svg(16, 16, "#ffffff") }], { ...SETTINGS, maxPageSize: 16 }, fakeRasterizer)))
      .toEqual(["atlas.too-large", "big"]);
    const broken: Rasterizer = { ...fakeRasterizer, rasterize: async ({ width, height }) => ({ width, height, data: new Uint8Array(width * height * 3) }) };
    expect(await rejected(compileAtlas(one("a"), SETTINGS, broken))).toEqual(["raster.shape", "a"]);
  });
});

describe("validateAtlas", () => {
  type Editable = { filter: string; pages: AtlasPage[]; regions: { -readonly [K in keyof AtlasRegion]: AtlasRegion[K] }[] };
  const edit = (atlas: Atlas, change: (copy: Editable) => void) => {
    const copy = { ...atlas, pages: [...atlas.pages], regions: atlas.regions.map((region) => ({ ...region })) };
    change(copy);
    return validateAtlas(copy as Atlas);
  };
  const problem = (pattern: RegExp) => expect.arrayContaining([expect.stringMatching(pattern)]);

  it("reports every way coordinates disagree with the pages", async () => {
    const { atlas } = await compileAtlas(SOURCES, SETTINGS, fakeRasterizer);
    const [first, second] = atlas.regions;
    expect(edit(atlas, (copy) => { copy.regions[0].u0 += 1e-9; })).toEqual([`${first.id}: UVs must be exactly the source rectangle over the page size`]);
    expect(edit(atlas, (copy) => { copy.regions = [...copy.regions].reverse(); })).toEqual(problem(/must be unique and sorted by ID/));
    expect(edit(atlas, (copy) => { copy.regions = [copy.regions[0], copy.regions[0]]; })).toEqual(problem(/must be unique and sorted by ID/));
    expect(edit(atlas, (copy) => { copy.regions[1].page = 9; })).toEqual([`${second.id}: page 9 does not exist`]);
    expect(edit(atlas, (copy) => { copy.pages[0] = { ...copy.pages[0], data: copy.pages[0].data.subarray(4) }; })).toEqual(["page 0: size disagrees with its data"]);
    expect(edit(atlas, (copy) => { copy.filter = "cubic"; })).toEqual(["unknown filter cubic"]);
    expect(edit(atlas, (copy) => {
      const target = copy.regions.find((region) => region.page === first.page && region.id !== first.id)!;
      Object.assign(target, { x: first.x, y: first.y });
    })).toEqual(problem(/overlaps/));
    expect(edit(atlas, (copy) => { Object.assign(copy.regions[0], { x: 0 }); })).toEqual(problem(/extrusion must lie inside page/));
  });
});

describe("prepareSvg", () => {
  it("rewrites the root to the raster size and keeps the source size", () => {
    expect(prepareSvg('<svg width="4" height="3"><rect width="4" height="3"/></svg>', 3, "a")).toEqual({
      svg: '<svg viewBox="0 0 4 3" xmlns="http://www.w3.org/2000/svg" width="12" height="9"><rect width="4" height="3"/></svg>',
      width: 12, height: 9, sourceWidth: 4, sourceHeight: 3,
    });
    const viewBoxOnly = prepareSvg('<?xml version="1.0"?>\n<!-- art -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"/>', 2, "b");
    expect(viewBoxOnly).toMatchObject({ width: 20, height: 10, sourceWidth: 10, sourceHeight: 5 });
    expect(viewBoxOnly.svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5" width="20" height="10"/>');
    expect(prepareSvg(svg(8, 8, "url(#shade)").replace("<rect", '<use href="#r"/><rect'), 1, "c").width).toBe(8);
  });

  it("refuses anything that reaches outside the document", () => {
    for (const body of [
      "<script>alert(1)</script>", "<foreignObject/>", '<image href="#x"/>', "<feImage/>", '<rect onload="x()"/>',
      '<use href="https://example.com/a.svg#r"/>', '<use xlink:href="other.svg#r"/>', '<rect fill="url(https://example.com/p)"/>',
      "<style>@import 'x.css';</style>", "<svg:script/>",
    ]) {
      expect(refusal(() => prepareSvg(`<svg width="4" height="4">${body}</svg>`, 1, "art"))).toEqual(["svg.unsafe", "art"]);
    }
    expect(refusal(() => prepareSvg('<!DOCTYPE svg><svg width="4" height="4"/>', 1, "art"))).toEqual(["svg.unsafe", "art"]);
  });

  it("refuses roots and sizes that do not map onto whole pixels", () => {
    for (const source of ["<g/>", '<rect/><svg width="4" height="4"/>', "<svg/>", '<svg width="50%" height="4"/>', '<svg viewBox="0 0 0 4"/>', '<svg viewBox="0 0 4"/>']) {
      expect(refusal(() => prepareSvg(source, 1, "art"))).toEqual(["svg.root", "art"]);
    }
    expect(refusal(() => prepareSvg(svg(3, 3, "#ffffff"), 0.5, "art"))).toEqual(["svg.size", "art"]);
    expect(refusal(() => prepareSvg(svg(SVG_LIMITS.maxDimension + 1, 1, "#ffffff"), 1, "art"))).toEqual(["svg.size", "art"]);
    expect(refusal(() => prepareSvg(svg(4, 4, "#ffffff") + " ".repeat(SVG_LIMITS.maxSourceBytes), 1, "art"))).toEqual(["svg.size", "art"]);
    expect(refusal(() => prepareSvg(svg(4, 4, "#ffffff"), -1, "art"))).toEqual(["atlas.settings", "scale"]);
  });
});
