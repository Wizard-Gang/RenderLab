// RenderLab's asset boundary: the one validated way MapLab, RigLab and compiled bundles enter the renderer. It imports
// only src/core/ and Web APIs (Web Crypto, TextDecoder), never PixiJS, React or the DOM, so it is testable on its own.
export { readBundle } from "./bundle";
export type { AssetBundle, BundleFile, ReadOptions } from "./bundle";
export { collectEntries, EntryBudget, MANIFEST, readFolder } from "./container";
export type { BundleContainer, BundleEntries } from "./container";
export { BundleError, CompatibilityError } from "./errors";
export type { BundleErrorCode } from "./errors";
export { contentId, sha256Hex, SHA256 } from "./identity";
export { MAX_JSON_DEPTH, parseJson } from "./json";
export type { JsonValue } from "./json";
export { ResourceRegistry } from "./lifecycle";
export type { ResourceEntrySnapshot, ResourceLease, ResourceState } from "./lifecycle";
export { EXTERNAL_MAPS_CONTRACT, MANIFEST_VERSIONS, MAPLAB_FIELDS, MAPLAB_ROLES, parseManifest } from "./manifest";
export type { BundleManifest, ManifestFile, ManifestFormat } from "./manifest";
export { contractSupport, negotiate } from "./negotiate";
export type { CompatibilityReport, ContractRef, ContractSupport, UnsupportedContract } from "./negotiate";
export { BUNDLE_LIMITS, NESTED_ARCHIVE, pathProblem } from "./paths";
export type { BundleLimits } from "./paths";
export { crc32, readZip } from "./zip";
