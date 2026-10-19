// The renderer-neutral runtime contract (specification §6.2). Backends implement it; callers never see PixiJS or GPU
// objects through it. It refines the specification's initial proposal: scene changes arrive as atomic deltas, and
// game state as validated presentation snapshots.
import type { Failures } from "../contracts/errors";
import { checkFinite, isRecord } from "../contracts/values";
import type { SceneDelta, SceneDirty } from "../scene/delta";
import type { SceneDefinition } from "../scene/model";
import type { PresentationSnapshot } from "../timeline/snapshot";
import type { LifecycleState } from "./state";

export type RendererBackend = "auto" | "webgl2" | "webgpu";
export type ActiveBackend = Exclude<RendererBackend, "auto">;

/** The drawing surface in CSS pixels, and the device pixels per CSS pixel. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export function checkViewport(failures: Failures, path: string, value: unknown): void {
  if (!isRecord(value)) return failures.add(path, "must be a viewport { width, height, dpr }");
  for (const field of ["width", "height", "dpr"] as const) {
    if (checkFinite(failures, `${path}.${field}`, value[field]) && value[field] <= 0) failures.add(`${path}.${field}`, "must be greater than 0");
  }
}

/** A number and how it was obtained. Estimates are never presented as hardware measurements (§18). */
export interface Metric {
  readonly value: number;
  readonly basis: "measured" | "counted" | "estimated";
}

export interface RecoveryEvent {
  /** Frames rendered when it happened, so recovery logs compare across runs and machines. */
  readonly at: number;
  readonly kind: "context-lost" | "restored" | "restore-failed" | "fallback";
  readonly detail: string;
}

export interface RendererDiagnostics {
  readonly state: LifecycleState;
  readonly backend: { readonly requested: RendererBackend; readonly active: ActiveBackend | null; readonly failure: string | null };
  readonly frames: {
    readonly rendered: number;
    readonly fps: Metric | null;
    readonly averageFrameMs: Metric | null;
    readonly p95FrameMs: Metric | null;
    readonly updateCpuMs: Metric | null;
  };
  readonly scene: { readonly id: string | null; readonly revision: number | null; readonly visibleChunks: number; readonly visibleCharacters: number; readonly activeParticles: number };
  /** `contexts` counts the graphics contexts this runtime holds; destroy must bring it and `textures` to 0. */
  readonly gpu: { readonly contexts: number; readonly drawCalls: Metric | null; readonly textures: number; readonly textureBytes: Metric | null };
  readonly recoveries: readonly RecoveryEvent[];
}

export function emptyDiagnostics(requested: RendererBackend, state: LifecycleState = "created"): RendererDiagnostics {
  return {
    state,
    backend: { requested, active: null, failure: null },
    frames: { rendered: 0, fps: null, averageFrameMs: null, p95FrameMs: null, updateCpuMs: null },
    scene: { id: null, revision: null, visibleChunks: 0, visibleCharacters: 0, activeParticles: 0 },
    gpu: { contexts: 0, drawCalls: null, textures: 0, textureBytes: null },
    recoveries: [],
  };
}

export interface RendererRuntime {
  initialize(): Promise<void>;
  /** Mount a scene, replacing any mounted one and releasing what only it used. */
  mountScene(scene: SceneDefinition): Promise<void>;
  /** Apply an atomic scene delta and update only what it dirtied. */
  applySceneDelta(delta: SceneDelta): SceneDirty;
  /** Present one fixed tick of game state. Never writes back into the game. */
  update(snapshot: PresentationSnapshot): void;
  /** Draw a frame; `alpha` from 0 to 1 is how far presentation has moved from the last tick toward the next. */
  render(alpha: number): void;
  resize(viewport: Viewport): void;
  getDiagnostics(): RendererDiagnostics;
  destroy(): Promise<void>;
}
