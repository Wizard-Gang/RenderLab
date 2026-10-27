// Every MapLab adapter refusal carries a stable code, the bundle file at fault and a JSON location inside it, so
// callers and tests match on codes, never on message wording. Codes follow MapLab's own reader where the defect is the
// same (MapLab conformance/bundle/cases.json); `adapter.unsupported` marks valid MapLab content RenderLab cannot
// present yet, which is refused rather than dropped (specification §8.1, §11.5).
export type MapLabErrorCode =
  | "manifest.canonical"
  | "manifest.order"
  | "manifest.unindexed"
  | "manifest.document-file"
  | "manifest.document-identity"
  | "document.canonical"
  | "document.version"
  | "document.unsupported-format"
  | `schema.${string}`
  | "contract.undeclared"
  | "contract.role"
  | "contract.duplicate"
  | "contract.unsupported"
  | "dependency.missing"
  | "dependency.identity"
  | "dependency.duplicate"
  | "dependency.path-identity"
  | "dependency.path-alias"
  | "closure.entry"
  | "closure.unreachable"
  | "object.duplicate"
  | "reference.dangling"
  | "reference.kind"
  | "reference.undeclared"
  | "portal.map"
  | "portal.entity"
  | "asset.extension"
  | "asset.missing"
  | "asset.path"
  | "adapter.unsupported";

export class MapLabError extends Error {
  readonly code: MapLabErrorCode;
  /** The bundle file at fault, such as `maps/forest.map.json`. */
  readonly file: string;
  /** A JSON location inside `file`, such as `$.visuals[2].layerId`. */
  readonly at: string;

  constructor(code: MapLabErrorCode, file: string, at: string, message: string) {
    super(`${code} at ${file} ${at}: ${message}`);
    this.name = "MapLabError";
    this.code = code;
    this.file = file;
    this.at = at;
  }
}

/** JSON location text: `$`, `$.layers[2].id`. */
export function jsonPath(segments: readonly (string | number)[]): string {
  return segments.reduce<string>((text, segment) => (typeof segment === "number" ? `${text}[${segment}]` : `${text}.${segment}`), "$");
}
