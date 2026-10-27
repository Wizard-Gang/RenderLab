# RenderLab

RenderLab is a reusable, GPU-native 2D rendering platform for browser games. It presents worlds authored in [MapLab](https://github.com/Wizard-Gang/MapLab) and characters and animation authored in [RigLab](https://github.com/Wizard-Gang/RigLab) through [PixiJS v8](https://pixijs.com/), with WebGL2 as the initial production backend and WebGPU as a fully supported, independently validated backend. It is not a game engine. A separate game or reference simulation owns authoritative state, and RenderLab only presents it: **author once, compile once, render anywhere.**

The [governing specification](docs/specifications/2026-10-18-renderlab.md) defines the platform and its baseline tasks, `RLDR-001`…`RLDR-021`. Governance, the toolchain, CI, the renderer-neutral core contracts (scene model, scene store, presentation snapshots and renderer lifecycle), the PixiJS v8 runtime on WebGL2 and WebGPU with capability-based backend selection, the 2D camera with smooth and strict-pixel policies, the validated bundle reader, SVG rasterization into deterministic texture atlases, and a reference application are in place. The renderer, asset pipeline and adapters follow in specification order through the [implementation plan](implementation_plan.md). [Architecture](docs/ARCHITECTURE.md) records what exists and the boundaries it enforces. [Testing](docs/TESTING.md) describes the test layers.

Controlled tasks use the `RLDR-###` namespace, plan-only changes `[PLAN]`, and the title and body format in [Change management](docs/CHANGE-MANAGEMENT.md). Task PRs squash into the open `release/rNNN` branch after `gate` and `change-id` pass on the exact head; the release PR rebase-merges into `main` after `verify`, `change-id` and `security`. The committed [GitHub settings](config/github-repository-settings.json) require:

- current-with-base status;
- rebase-only linear `main`, squash-only release branches and automatic completed-branch deletion;
- zero bypass actors;
- immutable Releases and immutable `v*` tags.

[AGENTS.md](AGENTS.md) carries the shared work protocol, and the [implementation plan](implementation_plan.md) is the current and future queue.

## Run locally

Use Node 26.10.0 and npm 12.1.0, matching the repository pins.

```bash
cd ~/Documents/GitHub/RenderLab && npm ci && npm start
```

`npm start` runs `npm run dev`, a managed launcher (`scripts/dev.mjs`) that serves the reference application at <http://localhost:5184> and opens it in the browser. The application draws a demo scene and shows the runtime's diagnostics and the probed capabilities. To move the camera, drag the scene, scroll over it, or focus it and use the arrow keys and **+** or **−**. **Reset view** brings the camera back. Every menu is also a URL parameter, so a view can be linked:

| Menu | URL parameter | Choices |
| --- | --- | --- |
| **Backend** | `?backend=` | Auto (WebGL2 first, WebGPU as fallback), WebGL2 or WebGPU; `?prefer=webgpu` makes Auto try WebGPU first |
| **Scene** | `?scene=` | The reference scene, or a pixel grid |
| **Pixels** | `?pixel=` | Smooth or strict pixel |
| **View** | `?view=` | Canvas size: 480×270, 640×360 or 320×180 | **Restart renderer** tears the runtime down and mounts it again. A backend that cannot run shows why instead of a blank canvas. Local development needs no account, credential, game server or network service. Each run follows the same lifecycle as the RigLab, SharkTank and WizardGang launchers:

1. **Teardown.** Stop the server this checkout last started, and any other RenderLab Vite still on the port, whether from this checkout or one of its worktrees. A port held by anything else is refused, and the message names the process. RenderLab never stops a process it cannot prove is its own.
2. **Reset.** Clear `dist/`, `node_modules/.vite/` and `tmp/dev/`.
3. **Install.** Run `npm ci` when `node_modules/` is missing or `package-lock.json` changed since the last install.
4. **Build.** Run `vite build`, so a broken import fails here.
5. **Start.** Start Vite on the port, wait until it answers, then open the browser.

Ctrl-C, `SIGTERM` or closing the terminal stops the server. A second `npm start` replaces a running one. `RENDERLAB_PORT=5195 npm start` serves on another port, for example from a worktree beside the main checkout. `RENDERLAB_NO_OPEN=1 npm start` (or `npm run dev -- --no-open`) skips the browser.

## Command map

`npm run check` is the canonical credential-free, offline acceptance gate. Browser, network and provider checks stay separate.

| Purpose | Command | Boundary |
| --- | --- | --- |
| Install exact dependencies | `npm ci` | Local install from the committed lockfile |
| Start the reference application | `npm start` | Runs `npm run dev`: teardown, reset, install, build, then the Vite dev server on 5184 |
| Repository acceptance | `npm run check` | Plan queue, workflow shell, repository and specification contracts, architecture boundaries, contract tests, types (including the DOM-free core), unit tests, build and change identity |
| Release-branch gate | `npm run check:gate` | The non-test checks CI's `gate` runs: plan queue, workflow shell, repository contract, architecture boundaries, fixtures, types and build |
| Unit tests | `npm test` | Vitest in the node environment |
| Browser tests | `npm run test:browser` | Playwright against the production build in Chromium and WebKit, including pixel readback on WebGL2 and WebGPU. Install the browsers once with `npx playwright install chromium webkit` |
| Terrain batching benchmark | `npm run bench:terrain` | Node-only geometry build and residency measurements behind `docs/PERFORMANCE.md`; no GPU, browser or network |
| Dependency advisory gate | `npm run audit:dependencies` | Network-backed npm registry query that fails on high or critical advisories |
| Committed patch whitespace | `npm run check:patch` | Needs `PATCH_BASE_SHA` and `PATCH_HEAD_SHA` |
| Live GitHub settings check | `npm run verify:github-settings` | Read-only provider comparison. Needs an administration-readable `GH_ADMIN_TOKEN` or `GH_TOKEN` |
| Apply GitHub settings | `npm run apply:github-settings` | Bounded settings mutation with independent read-back. Owner-authorized only |

## Integration boundaries

RenderLab consumes MapLab and RigLab **exports**: versioned bundles with SHA-256 manifests. It never uses their editors, storage or source code, and neither tool depends on RenderLab. Their live main branches are the authority for format details, and each adapter task re-reads them before it starts (specification §3). Collision, navigation and movement data in a MapLab export belongs to the game engine. RenderLab may draw it only as optional diagnostic overlays.

## Release

RenderLab has no release or deployment path yet. A release requires its own governed task; see [Release management](docs/RELEASE-MANAGEMENT.md).

## License

MIT; see [LICENSE](LICENSE).
