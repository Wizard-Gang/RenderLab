import type { Failures } from "./errors";

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * A 2D placement in world units, X right and Y down. `rotation` is in degrees, positive turning clockwise on screen,
 * the SVG and PixiJS convention in Y-down space and the unit MapLab and RigLab author in. Mirroring stays separate
 * from scale because pixel art and facing treat it differently. Authored values are kept exactly; nothing rounds them.
 */
export interface Transform2D {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly mirrorX: boolean;
  readonly mirrorY: boolean;
}

export const IDENTITY_TRANSFORM: Transform2D = Object.freeze({
  x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, mirrorX: false, mirrorY: false,
});

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function checkFinite(failures: Failures, path: string, value: unknown): value is number {
  if (typeof value === "number" && Number.isFinite(value)) return true;
  failures.add(path, "must be a finite number");
  return false;
}

export function checkInteger(failures: Failures, path: string, value: unknown, minimum = Number.MIN_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    failures.add(path, minimum === 0 ? "must be a whole number of at least 0" : "must be a safe integer");
  }
}

export function checkBoolean(failures: Failures, path: string, value: unknown): void {
  if (typeof value !== "boolean") failures.add(path, "must be true or false");
}

export function checkUnit(failures: Failures, path: string, value: unknown): void {
  if (checkFinite(failures, path, value) && (value < 0 || value > 1)) failures.add(path, "must be from 0 to 1");
}

export function checkVec2(failures: Failures, path: string, value: unknown): void {
  if (!isRecord(value)) {
    failures.add(path, "must be an { x, y } vector");
    return;
  }
  checkFinite(failures, `${path}.x`, value.x);
  checkFinite(failures, `${path}.y`, value.y);
}

export function checkTransform(failures: Failures, path: string, value: unknown): void {
  if (!isRecord(value)) {
    failures.add(path, "must be a transform");
    return;
  }
  for (const field of ["x", "y", "rotation", "scaleX", "scaleY"] as const) checkFinite(failures, `${path}.${field}`, value[field]);
  checkBoolean(failures, `${path}.mirrorX`, value.mirrorX);
  checkBoolean(failures, `${path}.mirrorY`, value.mirrorY);
}

/** A 24-bit 0xRRGGBB colour. */
export function checkColor(failures: Failures, path: string, value: unknown): void {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffffff) {
    failures.add(path, "must be a 0xRRGGBB colour from 0 to 16777215");
  }
}
