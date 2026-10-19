// Pure translation from the renderer-neutral model to display parameters. No PixiJS here, so it is unit-tested in node.
import { compareObjects, type LayerDescriptor, type ObjectId, type SceneObject, type SpriteObject } from "../../core";

export interface SpriteDisplay {
  readonly x: number;
  readonly y: number;
  /** Radians, positive clockwise on screen, as PixiJS expects. */
  readonly rotation: number;
  /** Mirroring is folded into the sign of the scale, about the anchor. */
  readonly scaleX: number;
  readonly scaleY: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly tint: number;
  readonly alpha: number;
  readonly visible: boolean;
}

export const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function spriteDisplay(object: SpriteObject): SpriteDisplay {
  const { transform } = object;
  return {
    x: transform.x,
    y: transform.y,
    rotation: toRadians(transform.rotation),
    scaleX: transform.mirrorX ? -transform.scaleX : transform.scaleX,
    scaleY: transform.mirrorY ? -transform.scaleY : transform.scaleY,
    anchorX: object.anchor.x,
    anchorY: object.anchor.y,
    tint: object.tint,
    alpha: object.alpha,
    visible: object.visible,
  };
}

export function layerDisplay(layer: LayerDescriptor): { readonly visible: boolean; readonly alpha: number } {
  return { visible: layer.visible, alpha: layer.opacity };
}

/** Each object's draw rank within its layer (0 draws first): ascending sortKey, then ascending ID. */
export function drawRanks(objects: Iterable<SceneObject>): Map<ObjectId, number> {
  return new Map([...objects].sort(compareObjects).map((object, rank) => [object.id, rank]));
}
