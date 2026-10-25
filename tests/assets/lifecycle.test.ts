import { describe, expect, it, vi } from "vitest";
import { contentId, ResourceRegistry } from "../../src/assets";

const id = contentId("a".repeat(64));
const other = contentId("b".repeat(64));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const registryWithLog = () => {
  const disposed: string[] = [];
  return { disposed, registry: new ResourceRegistry<string>((value) => disposed.push(value)) };
};

describe("ResourceRegistry", () => {
  it("shares one load among every lease and disposes only after the last release", async () => {
    const { disposed, registry } = registryWithLog();
    const load = vi.fn(async () => "texture");
    const sceneA = registry.acquire(id, load);
    const sceneB = registry.acquire(id, load);
    expect(await sceneA.ready).toBe("texture");
    expect(await sceneB.ready).toBe("texture");
    expect(load).toHaveBeenCalledTimes(1);
    expect(registry.snapshot()).toEqual([{ id, state: "ready", refs: 2 }]);

    sceneA.release();
    expect(registry.refs(id)).toBe(1);
    expect(disposed).toEqual([]);
    sceneB.release();
    expect(disposed).toEqual(["texture"]);
    expect(registry.snapshot()).toEqual([]);

    await registry.acquire(id, load).ready;
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("disposes a value whose leases were all released while it loaded", async () => {
    const { disposed, registry } = registryWithLog();
    const pending = deferred<string>();
    const lease = registry.acquire(id, () => pending.promise);
    lease.release();
    expect(registry.snapshot()).toEqual([{ id, state: "loading", refs: 0 }]);
    pending.resolve("late");
    await lease.ready;
    expect(disposed).toEqual(["late"]);
    expect(registry.snapshot()).toEqual([]);
  });

  it("keeps a loading value that is acquired again before it arrives", async () => {
    const { disposed, registry } = registryWithLog();
    const pending = deferred<string>();
    registry.acquire(id, () => pending.promise).release();
    const second = registry.acquire(id, () => Promise.reject(new Error("must not reload")));
    pending.resolve("kept");
    expect(await second.ready).toBe("kept");
    expect(registry.refs(id)).toBe(1);
    expect(disposed).toEqual([]);
  });

  it("rejects every waiting lease when a load fails, then lets the next acquire retry", async () => {
    const { disposed, registry } = registryWithLog();
    const failing = vi.fn(async (): Promise<string> => {
      throw new Error("404 atlas.png");
    });
    const first = registry.acquire(id, failing);
    const second = registry.acquire(id, failing);
    await expect(first.ready).rejects.toThrow("404 atlas.png");
    await expect(second.ready).rejects.toThrow("404 atlas.png");
    expect(failing).toHaveBeenCalledTimes(1);
    expect(registry.snapshot()).toEqual([]);

    const retry = registry.acquire(id, async () => "loaded");
    expect(await retry.ready).toBe("loaded");
    first.release();
    expect(registry.refs(id)).toBe(1);
    retry.release();
    expect(disposed).toEqual(["loaded"]);
  });

  it("refuses a second release of one lease", async () => {
    const { registry } = registryWithLog();
    const lease = registry.acquire(id, async () => "value");
    await lease.ready;
    lease.release();
    expect(lease.released).toBe(true);
    expect(() => lease.release()).toThrow(/already released/);
  });

  it("tracks distinct content separately, in ID order", async () => {
    const { disposed, registry } = registryWithLog();
    const b = registry.acquire(other, async () => "b");
    const a = registry.acquire(id, async () => "a");
    await Promise.all([a.ready, b.ready]);
    expect(registry.snapshot().map((entry) => entry.id)).toEqual([id, other]);
    b.release();
    expect(disposed).toEqual(["b"]);
    expect(registry.refs(id)).toBe(1);
  });
});
