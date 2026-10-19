import type { Failures } from "../contracts/errors";
import { checkFinite, isRecord } from "../contracts/values";
import { checkKeys } from "../scene/validate";

/** The world rectangle a camera keeps its view inside, in world units (X right, Y down). */
export interface CameraBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Where a scene's camera looks: the world point at the viewport centre, in world units (X right, Y down), a zoom in
 * CSS pixels per world unit, and optional bounds the view stays inside. `src/core/camera/view.ts` turns it into the
 * transform a renderer applies; the stored state is what was asked for, before bounds and the pixel policy.
 */
export interface CameraState {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly bounds: CameraBounds | null;
}

export function checkCamera(failures: Failures, path: string, value: unknown): void {
  if (!isRecord(value)) {
    failures.add(path, "must be a camera { x, y, zoom, bounds }");
    return;
  }
  checkKeys(failures, path, value, ["x", "y", "zoom", "bounds"]);
  checkFinite(failures, `${path}.x`, value.x);
  checkFinite(failures, `${path}.y`, value.y);
  if (checkFinite(failures, `${path}.zoom`, value.zoom) && value.zoom <= 0) failures.add(`${path}.zoom`, "must be greater than 0");
  // A missing field is already reported by checkKeys.
  if (value.bounds === null || value.bounds === undefined) return;
  if (!isRecord(value.bounds)) {
    failures.add(`${path}.bounds`, "must be null or bounds { minX, minY, maxX, maxY }");
    return;
  }
  const bounds = value.bounds;
  checkKeys(failures, `${path}.bounds`, bounds, ["minX", "minY", "maxX", "maxY"]);
  const finite = ["minX", "minY", "maxX", "maxY"].every((field) => checkFinite(failures, `${path}.bounds.${field}`, bounds[field]));
  if (finite && ((bounds.minX as number) >= (bounds.maxX as number) || (bounds.minY as number) >= (bounds.maxY as number))) {
    failures.add(`${path}.bounds`, "must have minX below maxX and minY below maxY");
  }
}
