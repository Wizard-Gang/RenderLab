import type { Failures } from "../contracts/errors";
import { checkId, type ResourceId } from "../contracts/ids";
import { checkInteger, isRecord } from "../contracts/values";

export type Facing = "left" | "right";

/**
 * What a character is playing, in authoritative fixed ticks (60 Hz for RigLab clips). The clip's length and looping
 * belong to the clip itself; the presentation samples it at `tick - entryTick`. A paused clip holds the pose of
 * `pausedAtTick`. Facing selects RigLab's facing-dependent depth profile, never a blind mirror (specification §9.7).
 */
export interface AnimationState {
  readonly clip: ResourceId;
  readonly entryTick: number;
  readonly facing: Facing;
  readonly pausedAtTick: number | null;
}

export function checkFacing(failures: Failures, path: string, value: unknown): void {
  if (value !== "left" && value !== "right") failures.add(path, 'must be "left" or "right"');
}

export function checkAnimation(failures: Failures, path: string, value: unknown): void {
  if (!isRecord(value)) {
    failures.add(path, "must be an animation state");
    return;
  }
  checkId(failures, `${path}.clip`, value.clip);
  checkInteger(failures, `${path}.entryTick`, value.entryTick, 0);
  checkFacing(failures, `${path}.facing`, value.facing);
  if (value.pausedAtTick !== null) {
    checkInteger(failures, `${path}.pausedAtTick`, value.pausedAtTick, 0);
    if (Number.isSafeInteger(value.pausedAtTick) && Number.isSafeInteger(value.entryTick)
        && (value.pausedAtTick as number) < (value.entryTick as number)) {
      failures.add(`${path}.pausedAtTick`, "must not precede entryTick");
    }
  }
}
