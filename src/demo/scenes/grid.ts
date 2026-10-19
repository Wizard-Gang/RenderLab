// The pixel-grid scene: a 16×16 checkerboard with one texel per world unit, seen at a fractional zoom and camera
// position. Under strict-pixel every texel becomes an equal square of whole device pixels; smooth zoom shows uneven
// texel widths. The browser tests read its pixels back.
import { IDENTITY_TRANSFORM, layerId, objectId, resourceId, sceneId, type CameraState, type SceneDefinition } from "../../core";

export const GRID_CAMERA: CameraState = Object.freeze({ x: 8.37, y: 5.21, zoom: 2.6, bounds: null });

export function gridScene(): SceneDefinition {
  return {
    id: sceneId("renderlab.grid"),
    resources: [{ id: resourceId("tex.checker"), kind: "texture", source: { authority: "renderlab:generated", id: "tex.checker", path: [] } }],
    layers: [{
      id: layerId("world"), parentId: null, order: 0, visible: true, opacity: 1, space: "world", parallax: { x: 1, y: 1 },
      occlusionFade: null, role: null, source: null,
    }],
    objects: [{
      kind: "sprite", id: objectId("checker"), layerId: layerId("world"), mobility: "static", visible: true, sortKey: 0,
      source: { authority: "renderlab:grid", id: "checker", path: [] }, transform: IDENTITY_TRANSFORM,
      texture: resourceId("tex.checker"), anchor: { x: 0, y: 0 }, tint: 0xffffff, alpha: 1,
    }],
    camera: GRID_CAMERA,
  };
}
