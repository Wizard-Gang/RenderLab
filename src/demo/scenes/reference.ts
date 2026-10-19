// The reference scene: a fixed arrangement whose pixels the browser tests read back. With RLDR-003's identity camera,
// one world unit is one CSS pixel from the canvas's top-left corner. Colours are PICO-8's, chosen to sit far apart.
import {
  IDENTITY_TRANSFORM, layerId, objectId, resourceId, sceneId,
  type LayerDescriptor, type SceneDefinition, type SpriteObject, type Transform2D,
} from "../../core";

export const REFERENCE_VIEWPORT = Object.freeze({ width: 480, height: 270 });
export const BACKGROUND = 0x101114;

export const COLOURS = Object.freeze({
  backdrop: 0x1d2b53,
  red: 0xff004d,
  green: 0x00e436,
  blue: 0x29adff,
  yellow: 0xffec27,
  white: 0xffffff,
});

function layer(id: string, order: number, parentId: string | null, space: "world" | "screen" = "world"): LayerDescriptor {
  return {
    id: layerId(id), parentId: parentId === null ? null : layerId(parentId), order, visible: true, opacity: 1, space,
    parallax: space === "world" ? { x: 1, y: 1 } : { x: 0, y: 0 }, occlusionFade: null, role: null, source: null,
  };
}

function sprite(id: string, layer: string, texture: string, transform: Partial<Transform2D>, extra: Partial<SpriteObject> = {}): SpriteObject {
  return {
    kind: "sprite", id: objectId(id), layerId: layerId(layer), mobility: "static", visible: true, sortKey: 0,
    source: { authority: "renderlab:reference", id, path: [] }, transform: { ...IDENTITY_TRANSFORM, ...transform },
    texture: resourceId(texture), anchor: { x: 0, y: 0 }, tint: COLOURS.white, alpha: 1, ...extra,
  };
}

const square = (id: string, x: number, y: number, tint: number, extra: Partial<SpriteObject> = {}) =>
  sprite(id, "world.props", "tex.white", { x, y, scaleX: 48, scaleY: 48 }, { tint, ...extra });

export function referenceScene(): SceneDefinition {
  return {
    id: sceneId("renderlab.reference"),
    resources: ["tex.white", "tex.split", "tex.crate", "tex.glass"].map((id) => ({
      id: resourceId(id), kind: "texture" as const, source: { authority: "renderlab:generated", id, path: [] },
    })),
    layers: [
      layer("backdrop", 0, null),
      layer("world", 1, null),
      layer("world.props", 0, "world"),
      layer("world.figures", 1, "world"),
      layer("hud", 2, null, "screen"),
    ],
    objects: [
      sprite("backdrop", "backdrop", "tex.white", { scaleX: REFERENCE_VIEWPORT.width, scaleY: REFERENCE_VIEWPORT.height }, { tint: COLOURS.backdrop }),
      square("square.red", 40, 40, COLOURS.red),
      square("square.green", 112, 40, COLOURS.green, { alpha: 0.5 }),
      square("square.blue", 184, 40, COLOURS.blue, { sortKey: 0 }),
      square("square.yellow", 208, 64, COLOURS.yellow, { sortKey: 1 }),
      sprite("split.plain", "world.figures", "tex.split", { x: 300, y: 40, scaleX: 16, scaleY: 32 }),
      sprite("split.mirrored", "world.figures", "tex.split", { x: 372, y: 56, scaleX: 16, scaleY: 32, mirrorX: true }, { anchor: { x: 0.5, y: 0.5 } }),
      sprite("split.turned", "world.figures", "tex.split", { x: 436, y: 56, scaleX: 16, scaleY: 32, rotation: 90 }, { anchor: { x: 0.5, y: 0.5 } }),
      sprite("crate", "world.figures", "tex.crate", { x: 40, y: 140, scaleX: 6, scaleY: 6 }),
      sprite("glass", "world.figures", "tex.glass", { x: 112, y: 140, scaleX: 48, scaleY: 48 }),
      sprite("hud.bar", "hud", "tex.white", { x: 8, y: 8, scaleX: 64, scaleY: 4 }),
    ],
    camera: { x: REFERENCE_VIEWPORT.width / 2, y: REFERENCE_VIEWPORT.height / 2, zoom: 1 },
  };
}
