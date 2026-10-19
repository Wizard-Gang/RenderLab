# RenderLab

RenderLab is a reusable, GPU-native 2D rendering platform for browser games. It presents worlds authored in [MapLab](https://github.com/Wizard-Gang/MapLab) and characters and animation authored in [RigLab](https://github.com/Wizard-Gang/RigLab) through [PixiJS v8](https://pixijs.com/), with WebGL2 as the initial production backend and WebGPU as a fully supported, independently validated backend. It is not a game engine. A separate game or reference simulation owns authoritative state, and RenderLab only presents it: **author once, compile once, render anywhere.**

The [governing specification](docs/specifications/2026-10-18-renderlab.md) defines the platform and its baseline tasks, `RLDR-001`…`RLDR-021`. The repository is at the bootstrap stage. Governance, the toolchain, CI and a reference application shell are in place, and the renderer, asset pipeline and adapters follow in specification order through the [implementation plan](implementation_plan.md). [Architecture](docs/ARCHITECTURE.md) records what exists and the boundaries it enforces. [Testing](docs/TESTING.md) describes the test layers.

Controlled changes use the `RLDR-###` namespace and the title and body format in [Change management](docs/CHANGE-MANAGEMENT.md). Required PR checks are `verify`, `change-id` and `security` on the exact head. The committed [GitHub settings](config/github-repository-settings.json) require:

- current-with-main status;
- squash-only merges and automatic completed-branch deletion;
- zero bypass actors;
- immutable Releases and immutable `v*` tags.

[AGENTS.md](AGENTS.md) carries the shared work protocol, and the [implementation plan](implementation_plan.md) is the current and future queue.

## Run locally

Use Node 26.10.0 and npm 12.1.0, matching the repository pins.

```bash
cd ~/Documents/GitHub/RenderLab && npm ci && npm start
```

`npm start` runs `npm run dev`, a managed launcher (`scripts/dev.mjs`) that serves the reference application at <http://localhost:5184> and opens it in the browser. Local development needs no account, credential, game server or network service. Each run follows the same lifecycle as the RigLab, SharkTank and WizardGang launchers:

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
| Repository acceptance | `npm run check` | Plan queue, workflow shell, repository and specification contracts, contract tests, types, unit tests, build and change identity |
| Unit tests | `npm test` | Vitest in the node environment |
| Browser tests | `npm run test:browser` | Playwright against the production build in Chromium and WebKit. Install the browsers once with `npx playwright install chromium webkit` |
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
