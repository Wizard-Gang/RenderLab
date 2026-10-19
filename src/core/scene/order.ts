import { compareIds, type LayerId } from "../contracts/ids";
import type { LayerDescriptor, SceneObject } from "./model";

/** Layer draw order: roots and then each layer's children in ascending `order`, every parent before its children. */
export function layerDrawOrder(layers: Iterable<LayerDescriptor>): LayerDescriptor[] {
  const children = new Map<LayerId | null, LayerDescriptor[]>();
  for (const layer of layers) {
    const siblings = children.get(layer.parentId) ?? [];
    siblings.push(layer);
    children.set(layer.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.order - b.order || compareIds(a.id, b.id));
  const ordered: LayerDescriptor[] = [];
  const visit = (parent: LayerId | null) => {
    for (const layer of children.get(parent) ?? []) {
      ordered.push(layer);
      visit(layer.id);
    }
  };
  visit(null);
  return ordered;
}

/** Draw order within one layer: ascending sortKey, then ascending ID. */
export function compareObjects(left: SceneObject, right: SceneObject): number {
  return left.sortKey - right.sortKey || compareIds(left.id, right.id);
}
