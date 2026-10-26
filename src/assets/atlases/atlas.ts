import type { Raster } from "../compilation/rasterizer";
import { pack, type PackSettings } from "./pack";

/** Texture filtering the atlas was built for. Pixel art takes nearest; extrusion keeps both free of bleeding. */
export type AtlasFilter = "nearest" | "linear";

export interface AtlasRegion {
  readonly id: string;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Normalized texture coordinates of exactly the source rectangle: x / page width through (x + width) / page width. */
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

export interface AtlasPage {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  /** RGBA8, straight alpha, rows top to bottom. */
  readonly data: Uint8Array;
}

export interface Atlas {
  readonly filter: AtlasFilter;
  readonly padding: number;
  readonly extrude: number;
  readonly pages: readonly AtlasPage[];
  /** Sorted by ID. */
  readonly regions: readonly AtlasRegion[];
}

/** Packs rasters into pages, copies each one in and extrudes its edge pixels outward. */
export function buildAtlas(entries: readonly { id: string; raster: Raster }[], settings: PackSettings & { filter: AtlasFilter }): Atlas {
  const rasters = new Map(entries.map((entry) => [entry.id, entry.raster]));
  const packing = pack(entries.map(({ id, raster }) => ({ id, width: raster.width, height: raster.height })), settings);
  const pages = packing.pages.map((size, index) => ({ index, ...size, data: new Uint8Array(size.width * size.height * 4) }));
  const e = settings.extrude;
  const regions = packing.placements.map((placement) => {
    const raster = rasters.get(placement.id)!;
    const page = pages[placement.page];
    for (let y = -e; y < placement.height + e; y += 1) {
      const sourceY = Math.min(placement.height - 1, Math.max(0, y));
      for (let x = -e; x < placement.width + e; x += 1) {
        const sourceX = Math.min(placement.width - 1, Math.max(0, x));
        const from = (sourceY * raster.width + sourceX) * 4;
        page.data.set(raster.data.subarray(from, from + 4), ((placement.y + y) * page.width + placement.x + x) * 4);
      }
    }
    return {
      ...placement,
      u0: placement.x / page.width, v0: placement.y / page.height,
      u1: (placement.x + placement.width) / page.width, v1: (placement.y + placement.height) / page.height,
    };
  });
  return { filter: settings.filter, padding: settings.padding, extrude: e, pages, regions };
}

/** Every way the atlas's coordinates disagree with its pages; empty when it is sound. */
export function validateAtlas(atlas: Atlas): string[] {
  const problems: string[] = [];
  if (atlas.filter !== "nearest" && atlas.filter !== "linear") problems.push(`unknown filter ${String(atlas.filter)}`);
  atlas.pages.forEach((page, index) => {
    if (page.index !== index || page.data.length !== page.width * page.height * 4) problems.push(`page ${index}: size disagrees with its data`);
  });
  const e = atlas.extrude;
  atlas.regions.forEach((region, index) => {
    const page = atlas.pages[region.page];
    if (index > 0 && !(atlas.regions[index - 1].id < region.id)) problems.push(`${region.id}: regions must be unique and sorted by ID`);
    if (!page) { problems.push(`${region.id}: page ${region.page} does not exist`); return; }
    if (!(region.width > 0 && region.height > 0) || region.x - e < 0 || region.y - e < 0
        || region.x + region.width + e > page.width || region.y + region.height + e > page.height) {
      problems.push(`${region.id}: rectangle and its extrusion must lie inside page ${region.page}`);
    }
    const expected = [region.x / page.width, region.y / page.height, (region.x + region.width) / page.width, (region.y + region.height) / page.height];
    if (![region.u0, region.v0, region.u1, region.v1].every((value, at) => value === expected[at])) {
      problems.push(`${region.id}: UVs must be exactly the source rectangle over the page size`);
    }
    for (const other of atlas.regions.slice(index + 1)) {
      if (other.page === region.page && region.x - e < other.x + other.width + e && other.x - e < region.x + region.width + e
          && region.y - e < other.y + other.height + e && other.y - e < region.y + region.height + e) {
        problems.push(`${region.id} overlaps ${other.id} on page ${region.page}`);
      }
    }
  });
  return problems;
}
