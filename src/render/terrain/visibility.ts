// Which terrain chunks the camera needs (specification §15.2): those whose rectangle meets the viewport, seen through
// their layer's placement, grown by a preload margin of whole chunks. Pure, so node tests it.
import { parallaxOffset, type CameraView, type LayerDescriptor, type TileChunkObject } from "../../core";
import { chunkRect } from "./geometry";

/** A layer container's own placement: a uniform scale, then a translation, relative to its parent's space. */
export interface Placement {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How a layer sits for a camera view. A world root layer carries the whole camera transform (zoom, then the origin
 * plus its parallax offset); a nested world layer adds only its parallax relative to its parent; screen layers stay put.
 */
export function layerPlacement(view: CameraView, layer: LayerDescriptor, parent: LayerDescriptor | undefined): Placement {
  if (layer.space === "screen") return { scale: 1, x: 0, y: 0 };
  const offset = parallaxOffset(view, layer.parallax, parent?.parallax);
  if (parent) return { scale: 1, x: offset.x, y: offset.y };
  return { scale: view.zoom, x: view.originX + offset.x * view.zoom, y: view.originY + offset.y * view.zoom };
}

/**
 * The viewport as a rectangle in a layer's own coordinates, or null when the layer or an ancestor is hidden.
 * `chain` runs from the root layer down to the layer itself.
 */
export function layerViewRect(view: CameraView, chain: readonly LayerDescriptor[]): Rect | null {
  let scale = 1;
  let x = 0;
  let y = 0;
  for (let index = 0; index < chain.length; index += 1) {
    const layer = chain[index];
    if (!layer.visible) return null;
    const placement = layerPlacement(view, layer, index ? chain[index - 1] : undefined);
    x += scale * placement.x;
    y += scale * placement.y;
    scale *= placement.scale;
  }
  return { x: (0 - x) / scale, y: (0 - y) / scale, width: view.viewport.width / scale, height: view.viewport.height / scale };
}

/** Whether a chunk lies inside `rect` grown by `margin` chunk widths and heights on every side; merely touching it is not inside. */
export function chunkWanted(chunk: Pick<TileChunkObject, "grid" | "column" | "row">, rect: Rect, margin: number): boolean {
  const own = chunkRect(chunk);
  const padX = margin * own.width;
  const padY = margin * own.height;
  return own.x < rect.x + rect.width + padX && rect.x - padX < own.x + own.width
    && own.y < rect.y + rect.height + padY && rect.y - padY < own.y + own.height;
}
