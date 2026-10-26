# Testing

RenderLab tests in layers. Each layer has one command, and the required `verify` CI check runs all of them on the exact PR head.

| Layer | Command | Runs | Needs |
| --- | --- | --- | --- |
| Governance and contracts | `npm run test:contracts` | `node --test tests/contracts/*.test.mjs`: change identity, plan queue, specification pin, workflows, provider policy, architecture boundaries, dev launcher | Node only |
| Architecture boundaries | `npm run check:boundaries` | The §5 import rules over every module under `src/` | Node only |
| Fixture provenance | `npm run check:fixtures` | Every file under `fixtures/` against `fixtures/provenance.json`: source repository, full commit, source path and SHA-256 | Node only |
| Unit | `npm test` | Vitest in the node environment over `tests/**/*.test.ts`, including the core scene, lifecycle and snapshot contracts in `tests/core/` and the bundle reader and atlas compiler in `tests/assets/` | Node only |
| Types | `npm run typecheck` | `tsc --noEmit` over sources, tests and configs, then `tsc -p tsconfig.core.json` over `src/core/` with no DOM library or Node types | Node only |
| Build | `npm run build` | Production `vite build` | Node only |
| Browser | `npm run test:browser` | Playwright against the production build in Chromium and WebKit: reference-scene pixels on each backend, backend selection and fallback, the no-WebGL2 and no-WebGPU messages, teardown and remount, context and device loss, strict-pixel texel squares at DPR 1 and 2, live resizing within camera bounds, keyboard pan and zoom checked against the core camera math, and SVG rasterization (exact pixel art, repeat determinism, antialiasing within the [documented tolerance](ASSET-PIPELINE.md#determinism-guarantees-and-their-limits)) | Browsers installed once with `npx playwright install chromium webkit` |
| Dependency advisories | `npm run audit:dependencies` | `npm audit --audit-level=high` (the `security` check) | Network |

`npm run check` is the canonical offline gate. It runs the plan-queue, workflow-shell, repository, boundary, contract, type, unit, build and change-identity checks, with no credentials, no network and no downloaded browsers. `npm run test:browser` stays outside it only because it needs browser binaries. CI installs them after `npm run check` and then runs the browser tests in the same required `verify` job, so a PR cannot merge without them. Locally, run both:

```bash
cd ~/Documents/GitHub/RenderLab && npm ci && npm run check && npm run test:browser
```

## Policies

- **Browsers.** Chromium covers Chrome and Edge, and WebKit stands in for Safari, the owner's browser. Later tasks add Firefox and real-device coverage where the specification's §17 requires it.
- **GPU capabilities.** A test that needs WebGL2 or WebGPU records whether the browser under test provides it. An unavailable capability is reported as unavailable, never skipped silently or counted as a pass (§19). Both CI browsers must provide WebGL2. WebGPU's probe result and actual start outcome are logged and annotated on every run. Where WebGPU does not start, the explicit-WebGPU test checks the reported reason, and the WebGPU-only tests skip with that reason. Chromium runs with SwiftShader flags (see [GPU backends](GPU-BACKENDS.md)). CI may still lack a presenting WebGPU device, so a change under `src/render/` also runs `npm run test:browser` locally on macOS, where both browsers present WebGPU, and records that run in its Validation field.
- **Pixels.** Rendering tests read real canvas output: a CSS-scale element screenshot decoded by `tests/browser/png.ts`, sampled at points whose expected colours come from the reference scene, within six steps per channel.
- **Determinism.** Unit tests that use randomness take a fixed seed. Snapshot and asset tests compare exact bytes only where the contract guarantees determinism, and document their tolerance everywhere else.
- **Fixtures.** MapLab and RigLab fixtures are copies of published exports and conformance cases, pinned by source repository, commit, path and SHA-256 (from RLDR-006).
- **Visual regression and performance** suites arrive in RLDR-019 and RLDR-020. Performance results are recorded evidence with a benchmark identity, never unqualified machine-specific assertions in CI.
