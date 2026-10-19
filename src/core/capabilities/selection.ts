// Choosing a graphics backend (specification §6.1, §6.4). `auto` tries its preferred backend first and the other one
// as a permitted fallback; an explicit backend is tried alone and never silently downgraded.
import type { ActiveBackend, RendererBackend } from "../lifecycle/runtime";
import type { Capabilities } from "./model";

export interface BackendPlan {
  readonly requested: RendererBackend;
  readonly order: readonly ActiveBackend[];
  /** Whether a later backend in `order` may be tried after an earlier one fails. */
  readonly fallback: boolean;
}

/** `auto` prefers WebGL2 until WebGPU's production qualification; a later governed change may flip the default. */
export const AUTO_PREFERENCE: ActiveBackend = "webgl2";

export function planBackends(requested: RendererBackend, preference: ActiveBackend = AUTO_PREFERENCE): BackendPlan {
  if (requested !== "auto") return { requested, order: [requested], fallback: false };
  return { requested, order: preference === "webgl2" ? ["webgl2", "webgpu"] : ["webgpu", "webgl2"], fallback: true };
}

export interface BackendAttempt {
  readonly backend: ActiveBackend;
  readonly outcome: "selected" | "unavailable" | "failed";
  readonly reason: string | null;
}

export const backendName = (backend: ActiveBackend): string => (backend === "webgl2" ? "WebGL2" : "WebGPU");

/** No permitted backend started. The message reads like the single failure when only one backend was tried. */
export class BackendSelectionError extends Error {
  readonly attempts: readonly BackendAttempt[];

  constructor(attempts: readonly BackendAttempt[]) {
    const describe = (attempt: BackendAttempt) =>
      `${backendName(attempt.backend)} ${attempt.outcome === "unavailable" ? "is unavailable" : "failed to start"}: ${attempt.reason}`;
    super(attempts.length === 1 ? describe(attempts[0]) : `no permitted graphics backend could start. ${attempts.map(describe).join("; ")}`);
    this.name = "BackendSelectionError";
    this.attempts = Object.freeze([...attempts]);
  }
}

const reasonOf = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "reason" in error && typeof error.reason === "string") return error.reason;
  return error instanceof Error ? error.message : String(error);
};

/**
 * Start the first backend the plan permits. A backend the probe found unavailable is skipped with its reason; one
 * that throws while starting is recorded as failed, and the next is tried only when the plan allows fallback. `start`
 * must release whatever it created before it throws.
 */
export async function selectBackend<T>(
  plan: BackendPlan, capabilities: Capabilities, start: (backend: ActiveBackend) => Promise<T>,
): Promise<{ readonly backend: ActiveBackend; readonly value: T; readonly attempts: readonly BackendAttempt[] }> {
  const attempts: BackendAttempt[] = [];
  for (const backend of plan.order) {
    if (attempts.length > 0 && !plan.fallback) break;
    const capability = capabilities[backend];
    if (!capability.available) {
      attempts.push({ backend, outcome: "unavailable", reason: capability.reason ?? "the probe found it unavailable" });
      continue;
    }
    try {
      const value = await start(backend);
      attempts.push({ backend, outcome: "selected", reason: null });
      return { backend, value, attempts };
    } catch (error) {
      attempts.push({ backend, outcome: "failed", reason: reasonOf(error) });
    }
  }
  throw new BackendSelectionError(attempts);
}
