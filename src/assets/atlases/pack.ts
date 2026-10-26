import { CompileError } from "../compilation/errors";

export interface PackItem {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

export interface PackSettings {
  readonly maxPageSize: number;
  /** Transparent pixels beyond the extrusion on every side of an image. */
  readonly padding: number;
  /** Edge pixels repeated outward on every side, so filtering at an edge never reads a neighbour. */
  readonly extrude: number;
}

/** Where one image's own pixels sit; its extrusion and padding surround this rectangle. */
export interface Placement {
  readonly id: string;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Packing {
  readonly pages: readonly { readonly width: number; readonly height: number }[];
  readonly placements: readonly Placement[];
}

interface Shelf { y: number; height: number; x: number }
interface Page { shelves: Shelf[]; used: number; placements: Placement[] }

const nextPowerOfTwo = (value: number) => 2 ** Math.ceil(Math.log2(Math.max(1, value)));

/**
 * Deterministic shelf packing. Items are placed tallest first (then widest, then by ID), each into the first page and
 * shelf with room, so the same items give the same packing whatever order they arrive in. Pages are the next power of
 * two that holds their contents, capped at `maxPageSize`.
 */
export function pack(items: readonly PackItem[], settings: PackSettings): Packing {
  const margin = settings.extrude + settings.padding;
  const max = settings.maxPageSize;
  const ordered = [...items].sort((a, b) => b.height - a.height || b.width - a.width || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pages: Page[] = [];
  for (const item of ordered) {
    const cellWidth = item.width + 2 * margin;
    const cellHeight = item.height + 2 * margin;
    if (cellWidth > max || cellHeight > max) {
      throw new CompileError("atlas.too-large", item.id, `${cellWidth}×${cellHeight} with extrusion and padding exceeds the ${max}-pixel page`);
    }
    let placed = false;
    for (const [index, page] of pages.entries()) {
      let shelf = page.shelves.find((candidate) => candidate.height >= cellHeight && candidate.x + cellWidth <= max);
      if (!shelf && page.used + cellHeight <= max) {
        shelf = { y: page.used, height: cellHeight, x: 0 };
        page.shelves.push(shelf);
        page.used += cellHeight;
      }
      if (!shelf) continue;
      page.placements.push({ id: item.id, page: index, x: shelf.x + margin, y: shelf.y + margin, width: item.width, height: item.height });
      shelf.x += cellWidth;
      placed = true;
      break;
    }
    if (!placed) {
      pages.push({ shelves: [{ y: 0, height: cellHeight, x: cellWidth }], used: cellHeight, placements: [] });
      pages.at(-1)!.placements.push({ id: item.id, page: pages.length - 1, x: margin, y: margin, width: item.width, height: item.height });
    }
  }
  return {
    pages: pages.map((page) => ({
      width: Math.min(max, nextPowerOfTwo(Math.max(...page.shelves.map((shelf) => shelf.x)))),
      height: Math.min(max, nextPowerOfTwo(page.used)),
    })),
    placements: pages.flatMap((page) => page.placements).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}
