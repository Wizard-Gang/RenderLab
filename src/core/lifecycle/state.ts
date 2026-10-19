// The renderer lifecycle every backend follows (specification §6.2, §6.4, §17). Runtimes drive this machine and ask it
// before acting, so an illegal call (rendering before a scene is mounted, anything after destroy) fails with a precise
// error instead of issuing invalid GPU commands.

export type LifecycleState = "created" | "initializing" | "ready" | "mounted" | "lost" | "failed" | "destroyed";

export type LifecycleEvent =
  | "initialize" | "initialized" | "initialize-failed"
  | "mount" | "unmount"
  | "lose" | "restore" | "restore-failed"
  | "destroy";

export type LifecycleOperation = "initialize" | "mountScene" | "applySceneDelta" | "update" | "render" | "resize" | "destroy";

export class LifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleError";
  }
}

const TRANSITIONS: Readonly<Record<LifecycleState, Partial<Record<LifecycleEvent, LifecycleState>>>> = {
  created: { initialize: "initializing", destroy: "destroyed" },
  initializing: { initialized: "ready", "initialize-failed": "failed", destroy: "destroyed" },
  ready: { mount: "mounted", lose: "lost", destroy: "destroyed" },
  mounted: { mount: "mounted", unmount: "ready", lose: "lost", destroy: "destroyed" },
  // `restore` returns to "mounted" when a scene was mounted at loss time, else "ready" (see `transition`).
  lost: { restore: "ready", "restore-failed": "failed", destroy: "destroyed" },
  failed: { destroy: "destroyed" },
  destroyed: {},
};

const OPERATIONS: Readonly<Record<LifecycleOperation, readonly LifecycleState[]>> = {
  initialize: ["created"],
  mountScene: ["ready", "mounted"],
  applySceneDelta: ["mounted"],
  update: ["mounted"],
  render: ["mounted"],
  // A size given while the device is lost is kept for the restore.
  resize: ["ready", "mounted", "lost"],
  destroy: ["created", "initializing", "ready", "mounted", "lost", "failed"],
};

const HINTS: Partial<Record<LifecycleState, string>> = {
  created: "initialize the renderer first",
  initializing: "wait for initialization to finish",
  ready: "mount a scene first",
  lost: "the graphics device is lost; wait for it to be restored",
  failed: "the renderer failed; destroy it and create a new one",
  destroyed: "the renderer is destroyed",
};

export class RendererLifecycle {
  #state: LifecycleState = "created";
  #sceneMounted = false;
  #failure: string | null = null;

  get state(): LifecycleState {
    return this.#state;
  }

  /** Whether a scene is mounted, or was mounted when the device was lost and will come back on restore. */
  get sceneMounted(): boolean {
    return this.#sceneMounted;
  }

  /** Why initialization or restoration failed, when it did. */
  get failure(): string | null {
    return this.#failure;
  }

  can(operation: LifecycleOperation): boolean {
    return OPERATIONS[operation].includes(this.#state);
  }

  assert(operation: LifecycleOperation): void {
    if (!this.can(operation)) {
      throw new LifecycleError(`cannot ${operation} while the renderer is ${this.#state}: ${HINTS[this.#state] ?? "this call is not allowed now"}`);
    }
  }

  transition(event: LifecycleEvent, reason?: string): LifecycleState {
    const next = TRANSITIONS[this.#state][event];
    if (next === undefined) throw new LifecycleError(`lifecycle event ${event} is not allowed while the renderer is ${this.#state}`);
    if (event === "initialize-failed" || event === "restore-failed") this.#failure = reason ?? event;
    if (event === "mount") this.#sceneMounted = true;
    if (event === "unmount" || event === "destroy") this.#sceneMounted = false;
    this.#state = event === "restore" && this.#sceneMounted ? "mounted" : next;
    return this.#state;
  }
}
