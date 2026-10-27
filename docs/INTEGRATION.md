# Integration

RenderLab presents what MapLab and RigLab export; it never edits, simulates or re-authors their data (specification §3). Each tool's export enters through its own adapter under `src/adapters/`, on top of the shared bundle reader in `src/assets/` ([ASSET-PIPELINE.md](ASSET-PIPELINE.md)). An adapter turns a validated bundle into renderer-neutral `SceneDefinition`s from `src/core/` and keeps every source ID traceable.

## MapLab adapter

`src/adapters/maplab/` is an independent, editor-free reader for `maplab.export` v1 bundles (§3.1, §3.3, §8). It imports only `src/adapters/maplab/`, `src/assets/`, `src/core/` and MapLab's published schemas pinned under `fixtures/maplab/schemas/`, never MapLab code. `npm run check:boundaries` enforces that.

### Reading an export

`readMapLabExport(container, { expectDigest? })` runs §8.1 steps 1–11 and refuses the whole bundle at the first failure. A container, manifest, inventory or negotiation failure is a `BundleError` from `readBundle`. Everything after that is a `MapLabError` carrying a stable `code`, the bundle `file` at fault and a JSON location `at`, such as `$.visuals[2].layerId`. Its codes follow MapLab's own reader wherever the defect is the same.

1. **Bundle.** `readBundle` with `MAPLAB_SUPPORT` reads the container, manifest and inventory, and negotiates the required contracts against `MAPLAB_CONTRACTS`. Those are the six document formats plus the camera, collision, climb and reference-controller contracts, each at v1.
2. **Manifest rules.** The manifest must be RFC 8785 canonical. Files must be sorted by path and documents by ID. Every authored file must be indexed as exactly one document. A bundled schema must be byte-for-byte one of the pinned schemas, and assets must be PNG, WebP, SVG, Ogg or WAV.
3. **Documents.** Each document must be canonical JSON whose format, ID and version match its manifest entry, at v1, and must pass its pinned schema (`schema.<keyword>` codes). Every contract a document names must be declared in `requiredContracts`, known and fit for its role.
4. **Closure.** Dependencies must name bundled documents by their manifest path and kind. A required dependency must be present. An absent optional one keeps a single path across the bundle and never aliases a bundled file. Every document must be reachable from `entryMapId`.
5. **References.** Object IDs are unique across a map's collections. Every ID-bearing field resolves to an object of the expected kind or to a document in the map's closure. A tileset or prefab must be one the map declares itself. A portal's destination must be the map itself or a map in its dependency closure, and the entity it names must exist there. Tileset tiles, terrains and rules are checked the same way.
6. **Scenes.** Each bundled map becomes a `MapLabScene`.

MapLab also refuses some bundles on engine semantics: catalog calls and catalog contents, typed refs inside `params`, movement abilities, and which body's shape a foothold edge uses. RenderLab checks the schemas and contracts of that data and reads it as a reference, but it never checks its meaning (§3.1, §8.5). `tests/adapters/maplab/conformance.test.ts` lists each such case with its reason.

### Scenes and handles

`MapLabWorld.maps` holds one `MapLabScene` per map, in manifest order:

- **`definition`** is a `SceneDefinition` with ID `maplab:<mapId>`. MapLab IDs pass through unchanged.
  - **Layers** keep their order, parent, visibility, opacity and kind (as `role`). A camera-space background layer is in screen space, and background parallax carries over.
  - **Shape visuals** become `shape` objects.
  - **Asset visuals** become `sprite` objects. The anchor is `pivot ÷ asset size`, and the transform scale is multiplied by the asset's `wuPerAssetUnit`.
  - **Terrain chunks** become `tile-chunk` objects with ID `<layerId>:<tilesetId>:chunk:<column>,<row>`.
  - **Resources.** Each tileset becomes a `tileset` resource and each image asset a `texture` resource.
  - **Camera.** The camera starts at the centre of the default bounds, at the default zoom.
- **`backgrounds`** keeps each background layer's space, origin, repeat, repeat size, scroll per tick and phase for layer composition (RLDR-010).
- **`handles`** maps every source object ID in the map to its collection, its runtime handle (`layer`, `object` or `resource`, or null for content read only as a reference, such as bodies, regions and entities) and, for prefab-expanded content, `expandedFrom: { placementId, prefabId }`.

A visual's mobility is `dynamic` when it is bound to a body whose mobility is not static.

### Not presented yet

Valid MapLab content that RenderLab cannot present yet is refused with `adapter.unsupported`, never dropped:

| Content | Where | Presented by |
| --- | --- | --- |
| Frame-sequence visuals | `$.visuals[i].source` | RLDR-014 |
| A visual with a non-null `parentId` | `$.visuals[i].parentId` | RLDR-010 |
| Non-empty `presentations` | `$.presentations` | RLDR-011 |
| `foreign` files (embedded RigLab bundles) | `manifest.json` `$.files[i]` | RLDR-011 |
| `riglab` dependencies | `$.dependencies[i]` | RLDR-011 |

### Fixtures and tests

`fixtures/maplab/` holds MapLab's forest export, its published schemas and its bundle conformance cases, byte-exact under the provenance lock in `fixtures/provenance.json`. `tests/adapters/maplab/` loads the forest export and builds every map into a valid `SceneStore`. It also applies all of MapLab's conformance edit records in memory with `mutate.ts`, a port of MapLab's `tests/consumer/mutate.mjs`, and covers what the forest leaves empty (terrain chunks, sprite art) with synthetic edits, along with every `adapter.unsupported` path.
