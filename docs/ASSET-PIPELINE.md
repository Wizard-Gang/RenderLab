# Asset pipeline

Every MapLab, RigLab and compiled asset enters RenderLab through one validated bundle reader in `src/assets/` (specification §8.1, §11.4–11.5, §12). It imports only `src/assets/`, `src/core/` and the Web APIs that browsers and Node share (Web Crypto, `TextDecoder`). It never imports PixiJS, React or the DOM, and `npm run check:boundaries` enforces that. The one exception to Node-and-browser neutrality is the browser rasterizer below, which touches `Image` and a 2D canvas only when it is called.

## Reading a bundle

`readBundle(container, { support, expectDigest? })` runs §8.1 steps 1–6 and refuses the whole bundle at the first failure. It never skips required content.

1. **Container.** `readFolder(pairs)` takes relative POSIX paths and bytes, such as a directory picker or fetched files give. `readZip(bytes)` takes a STORE (uncompressed) ZIP, the archive RigLab writes. Both validate every path and bound before any manifest is trusted. When no `manifest.json` sits at the root and every entry sits under one folder that holds it (RigLab's `riglab-export/`), that folder is the bundle root, and `container.root` records it.
2. **Manifest.** `manifest.json` is parsed by a strict JSON parser. It refuses a byte-order mark, invalid UTF-8, duplicate members, lone surrogates and nesting deeper than 64 levels. `JSON.parse` would silently keep the last duplicate, so two readers could see different manifests in the same bytes. The `format` field selects a profile, the version must be one the profile reads exactly, and unknown fields are refused.
3. **Inventory.** No entry may be unlisted and no listed file may be missing. Every listed size must match where the format lists sizes, and every listed SHA-256 must match the bytes.
4. **Negotiation.** The bundle's required contracts are compared with `support`, the contract keys and versions the consuming adapter renders. Every unmet requirement goes into one `CompatibilityReport`, with the versions supported instead and the action to take. That report rides on a `CompatibilityError` (`contract.unsupported`).

Steps 7–11 belong to the format adapters: schemas, semantic references, dependency closure, scene building and source-ID mapping (MapLab in RLDR-008, RigLab in RLDR-011). They read the parsed manifest from `bundle.manifest.source`.

## Bounds

`BUNDLE_LIMITS` follows MapLab's reader: 20,000 entries, 512 MiB in total, 256 MiB per entry, paths of at most 240 characters and at most 16 folders deep. Paths use MapLab's portable grammar: POSIX segments of letters, digits, `.`, `_` and `-` that never start with `.` or `-` and never end with `.`. That rules out `..`, hidden files, absolute paths, backslashes and empty segments. Windows device names, case aliases, a path that is both a file and a folder, empty folders, special files and nested archives are refused too.

The ZIP reader checks sizes from the central directory before it reads data. The end record must close the file, every local header must agree with its central record, data ranges must not overlap, and each CRC-32 must match. It refuses compression methods other than STORE, encryption, ZIP64 and multi-disk archives rather than half-reading them.

## Manifest profiles

| Format | Versions | Listing | Required contracts |
| --- | --- | --- | --- |
| `maplab.export` | 1 | `files[]`: path, size, SHA-256 and role (`authored`, `asset`, `schema`, `derived`, `foreign`) | `requiredContracts[]`, plus `maplab.external-maps` when `externalMaps` is non-empty |
| `riglab.export` | 1 | rig, `animations[]`, optional `weapons[]` and `baked[]`, each a file and SHA-256 | none at manifest level; RLDR-011 checks document versions |

The MapLab profile mirrors MapLab's `schemas/maplab.export.v1.schema.json` field for field, and a test compares it with the locked copy. The RigLab profile mirrors `Manifest` in RigLab's `src/export/bundle.ts`. RigLab lists no sizes, so its files are pinned by SHA-256 alone, and a changed size surfaces as a digest mismatch. `maplab.external-maps` is RenderLab's name for what linked external map bundles require: resolving other bundles, which no reader supports yet. So such a bundle is reported, not silently cut short.

## Integrity is not identity

`bundle.digest` is the SHA-256 of `manifest.json`, which pins every other file. For MapLab it equals the `bundleSha256` in MapLab's conformance cases. A matching digest proves the bytes are the ones the manifest describes. It never proves who published them. A forger can edit a manifest and recompute every hash. `bundle.publisher` is therefore `{ claimed, verified: false }`, and nothing in RenderLab sets `verified`. Tying a bundle to what a publisher released takes a digest obtained from a trusted channel outside the bundle: pass it as `expectDigest`, and a mismatch is refused with `bundle.digest`.

## Identity and the loading lifecycle

A resource's identity is its content: `contentId(sha256)` gives `sha256:<hex>`, and every listed file carries it as `id`. Equal bytes from any bundle, path or scene are one resource.

`ResourceRegistry<T>` is the reference-counted loading lifecycle. `acquire(id, load)` returns a lease. Leases on the same ID share one load and one value. The value is disposed once the last lease is released, and never while another scene holds one. If every lease is released while the value is still loading, the value is disposed as soon as it arrives. A failed load rejects every waiting lease and leaves nothing behind, so the next acquire retries. Releasing a lease twice throws. `snapshot()` lists held resources for diagnostics. There is no persistent cache: IndexedDB stays out until it materially helps (§12.2).

## Refusal codes

Every refusal is a `BundleError` with a stable `code` and `at`. `at` is the entry path, the manifest location (`$.files[2].sha256`) or null for the whole archive.

| Prefix | Codes |
| --- | --- |
| `container.` | `path`, `duplicate`, `conflict`, `limit`, `nested-archive`, `empty-directory`, `special-file` |
| `zip.` | `structure`, `unsupported`, `compression`, `encrypted`, `name`, `crc`, `overlap` |
| `json.` | `bom`, `utf8`, `syntax`, `surrogate`, `duplicate-key`, `depth` |
| `manifest.` | `missing`, `format`, `field`, `path`, `duplicate`, `self` |
| `inventory.` | `unlisted`, `missing`, `size`, `sha256` |
| `contract.` | `version`, `duplicate`, `unsupported` |
| `bundle.` | `digest` |

## Rasterization and atlases

RigLab and MapLab art is SVG; `compileAtlas` in `src/assets/atlases/` turns it into RGBA8 atlas pages, UV regions and a manifest (specification §10, §11.1–11.3). Pixel-art sources follow RigLab's `docs/SVGPIXELART.md` and `riglab.palette` on its live main: whole-pixel rectangles in palette colours, which is what the exactness guarantee below covers.

- **Preparation.** `prepareSvg` (`src/assets/compilation/svg.ts`) refuses anything that reaches outside the document: document types and entities, scripts, `foreignObject`, images, event handlers, `@import` and any `href` or `url()` that is not a `#` fragment. Sources are at most 1 MiB. The source size is the root's pixel `width` and `height`, or its `viewBox`; an explicit `scale` must turn it into whole pixels no larger than 4096 on a side, so pixel art lands on the pixel grid exactly.
- **Rasterizer.** `browserRasterizer` draws the prepared document through the browser's own SVG renderer into a CPU-backed 2D canvas (`willReadFrequently`, sRGB) and reads back straight-alpha RGBA8. It was chosen over a WebAssembly rasterizer because it needs no dependency, stays React and TypeScript only, and is the renderer the art is authored and previewed in. Any `Rasterizer` can stand in; the tests use a deterministic pattern rasterizer.
- **Packing.** `pack` is a shelf packer. Items go tallest first, then widest, then by ID, into the first page and shelf with room, so arrival order never changes the result. Each image keeps `extrude` pixels of its own edge repeated outward and `padding` transparent pixels beyond. Pages are the next power of two that holds them, capped at `maxPageSize` (16–16384, at most the device's texture limit); sources spill onto further pages, and one that cannot fit a page with its margins is refused.
- **UVs and filtering.** Regions are keyed and sorted by stable source ID. `u0 = x / pageWidth` through `u1 = (x + width) / pageWidth` (and likewise for `v`) cover exactly the source rectangle; `validateAtlas` reports any region whose UVs, bounds, order or overlap disagree with its pages. The atlas records `nearest` or `linear` filtering. Linear needs at least one pixel of extrusion; with it, a sample anywhere inside a region's UVs, edges included, reads only that source's pixels under either filter.
- **Manifest.** `renderlab.atlas` v1 records the compiler (`renderlab-atlas` 1.0.0, bumped whenever the same inputs could give different bytes), the rasterizer's name, version and caller-declared environment, the settings, each source's SHA-256 and size, each page's size, format, byte count and SHA-256, the regions, and the required texture size.

Compilation refuses with a `CompileError` carrying a stable `code` and `at` (a source ID or setting): `svg.root`, `svg.size`, `svg.unsafe`, `raster.shape`, `atlas.id`, `atlas.duplicate`, `atlas.settings` and `atlas.too-large`.

### Determinism guarantees and their limits

- Packing, extrusion, UVs and the manifest are pure functions of the source IDs and sizes and the settings: byte-identical in any environment (Vitest, `tests/assets/atlas.test.ts`).
- Pixels are identical for the same sources, compiler version, settings and rasterizer environment: one browser engine and version. Repeat rasterization in one browser gives the same bytes (Playwright, `tests/browser/rasterize.spec.ts`).
- Across engines, whole-pixel rectangles at a whole-number scale (with `shape-rendering="crispEdges"`) come back exact in both Chromium and WebKit. Antialiased edges differ by engine: the documented tolerance is total coverage within 2% of the analytic area, with partially covered pixels only within 1.5 pixels of the true edge. RenderLab makes no claim of cross-engine byte identity beyond that, which is why the manifest records the environment.
- Compressed GPU texture formats are out of scope (specification §11.3); pages are uncompressed RGBA8.

## Fixtures and their provenance lock

Copied fixtures live under `fixtures/`. `fixtures/provenance.json` records every one: source repository (`Wizard-Gang/MapLab` or `Wizard-Gang/RigLab`), full commit, source path and SHA-256. `npm run check:fixtures` (part of `npm run check`) refuses any fixture that is unlisted, missing or changed. The check is offline, so whoever copies or refreshes a fixture re-reads the source at the recorded commit and says so in the change. Today the lock holds MapLab's forest export and its `maplab.export` v1 schema at MapLab commit `30ad4acfff988a9de5ef7defaa9381b359d17fb1`. RigLab's main commits no export fixture, so RigLab-shaped test bundles are built in `tests/assets/helpers.ts`, and RLDR-011 locks a real export.
