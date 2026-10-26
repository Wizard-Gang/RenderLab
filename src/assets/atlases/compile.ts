import { sha256Hex } from "../identity";
import { CompileError } from "../compilation/errors";
import { checkRaster, type Rasterizer, type RasterizerIdentity } from "../compilation/rasterizer";
import { prepareSvg } from "../compilation/svg";
import { buildAtlas, type Atlas, type AtlasFilter } from "./atlas";

/** Bumped whenever the same inputs and settings could give different atlas bytes. */
export const ATLAS_COMPILER = Object.freeze({ name: "renderlab-atlas", version: "1.0.0" });
export const ATLAS_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export interface AtlasSettings {
  /** Raster pixels per source pixel; every source must land on whole pixels. */
  readonly scale: number;
  /** The largest page edge, at most the device's texture limit. */
  readonly maxPageSize: number;
  readonly padding: number;
  readonly extrude: number;
  readonly filter: AtlasFilter;
}

export interface AtlasManifest {
  readonly format: "renderlab.atlas";
  readonly version: 1;
  readonly compiler: typeof ATLAS_COMPILER;
  readonly rasterizer: RasterizerIdentity;
  readonly settings: AtlasSettings;
  readonly requiredFeatures: { readonly maxTextureSize: number };
  readonly sources: readonly { id: string; sha256: string; width: number; height: number }[];
  readonly pages: readonly { index: number; width: number; height: number; format: "rgba8unorm"; alpha: "straight"; bytes: number; sha256: string }[];
  readonly regions: Atlas["regions"];
}

const wholeIn = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

function checkSettings(settings: AtlasSettings): void {
  if (!wholeIn(settings.maxPageSize, 16, 16384)) throw new CompileError("atlas.settings", "maxPageSize", "must be a whole number from 16 to 16384");
  if (!wholeIn(settings.padding, 0, 64)) throw new CompileError("atlas.settings", "padding", "must be a whole number from 0 to 64");
  if (!wholeIn(settings.extrude, 0, 64)) throw new CompileError("atlas.settings", "extrude", "must be a whole number from 0 to 64");
  if (settings.filter !== "nearest" && settings.filter !== "linear") throw new CompileError("atlas.settings", "filter", "must be nearest or linear");
  if (settings.filter === "linear" && settings.extrude < 1) throw new CompileError("atlas.settings", "extrude", "linear filtering needs at least 1 pixel of extrusion");
}

/**
 * Compiles SVG sources into atlas pages and their manifest. Sources are rasterized one at a time in ID order, so the
 * same sources, compiler version, settings and rasterizer environment give byte-identical pages.
 */
export async function compileAtlas(
  sources: readonly { id: string; svg: string }[], settings: AtlasSettings, rasterizer: Rasterizer,
): Promise<{ atlas: Atlas; manifest: AtlasManifest }> {
  checkSettings(settings);
  const ordered = [...sources].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ordered.forEach((source, index) => {
    if (!ATLAS_ID.test(source.id)) throw new CompileError("atlas.id", source.id, "IDs are 1-200 characters of A-Z a-z 0-9 . _ : / -");
    if (index > 0 && ordered[index - 1].id === source.id) throw new CompileError("atlas.duplicate", source.id, "each source ID appears once");
  });
  const encoder = new TextEncoder();
  const entries = [];
  const sourceRecords = [];
  for (const source of ordered) {
    const prepared = prepareSvg(source.svg, settings.scale, source.id);
    const request = { svg: prepared.svg, width: prepared.width, height: prepared.height };
    entries.push({ id: source.id, raster: checkRaster(await rasterizer.rasterize(request), request, source.id) });
    sourceRecords.push({ id: source.id, sha256: await sha256Hex(encoder.encode(source.svg)), width: prepared.sourceWidth, height: prepared.sourceHeight });
  }
  const atlas = buildAtlas(entries, settings);
  const pages = [];
  for (const page of atlas.pages) {
    pages.push({ index: page.index, width: page.width, height: page.height, format: "rgba8unorm" as const, alpha: "straight" as const,
      bytes: page.data.length, sha256: await sha256Hex(page.data) });
  }
  const manifest: AtlasManifest = {
    format: "renderlab.atlas", version: 1, compiler: ATLAS_COMPILER, rasterizer: rasterizer.identity,
    settings: { scale: settings.scale, maxPageSize: settings.maxPageSize, padding: settings.padding, extrude: settings.extrude, filter: settings.filter },
    requiredFeatures: { maxTextureSize: Math.max(0, ...atlas.pages.flatMap((page) => [page.width, page.height])) },
    sources: sourceRecords, pages, regions: atlas.regions,
  };
  return { atlas, manifest };
}
