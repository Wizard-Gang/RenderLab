import type { Failures } from "../contracts/errors";
import { checkFinite, isRecord } from "../contracts/values";

/**
 * Where a scene's camera looks: the world point at the viewport centre, in world units (X right, Y down), and a
 * zoom in screen pixels per world unit before DPR. Camera behaviour (bounds, follow, snapping, transforms) is
 * RLDR-005's; this is only the state the scene model carries.
 */
export interface CameraState {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export function checkCamera(failures: Failures, path: string, value: unknown): void {
  if (!isRecord(value)) {
    failures.add(path, "must be a camera { x, y, zoom }");
    return;
  }
  checkFinite(failures, `${path}.x`, value.x);
  checkFinite(failures, `${path}.y`, value.y);
  if (checkFinite(failures, `${path}.zoom`, value.zoom) && value.zoom <= 0) failures.add(`${path}.zoom`, "must be greater than 0");
}
