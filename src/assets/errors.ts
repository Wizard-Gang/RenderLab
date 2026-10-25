import type { CompatibilityReport } from "./negotiate";

// Every refusal carries a stable code, so callers and tests match on codes, never on message wording.
export type BundleErrorCode =
  | "container.path"
  | "container.duplicate"
  | "container.conflict"
  | "container.limit"
  | "container.nested-archive"
  | "container.empty-directory"
  | "container.special-file"
  | "zip.structure"
  | "zip.unsupported"
  | "zip.compression"
  | "zip.encrypted"
  | "zip.name"
  | "zip.crc"
  | "zip.overlap"
  | "json.bom"
  | "json.utf8"
  | "json.syntax"
  | "json.surrogate"
  | "json.duplicate-key"
  | "json.depth"
  | "manifest.missing"
  | "manifest.format"
  | "manifest.field"
  | "manifest.path"
  | "manifest.duplicate"
  | "manifest.self"
  | "inventory.unlisted"
  | "inventory.missing"
  | "inventory.size"
  | "inventory.sha256"
  | "contract.version"
  | "contract.duplicate"
  | "contract.unsupported"
  | "bundle.digest";

/** A refused bundle: the first failure found, naming the entry path or manifest location at fault. */
export class BundleError extends Error {
  readonly code: BundleErrorCode;
  /** A bundle entry (`maps/forest.map.json`), a manifest location (`$.files[2].sha256`) or null for the whole bundle. */
  readonly at: string | null;

  constructor(code: BundleErrorCode, at: string | null, message: string) {
    super(at === null ? `${code}: ${message}` : `${code} at ${at}: ${message}`);
    this.name = "BundleError";
    this.code = code;
    this.at = at;
  }
}

/** A bundle that needs contracts or versions the reader does not support; the report lists every one of them. */
export class CompatibilityError extends BundleError {
  readonly report: CompatibilityReport;

  constructor(report: CompatibilityReport) {
    super("contract.unsupported", "$.requiredContracts", report.unsupported.map((item) => item.reason).join("; "));
    this.name = "CompatibilityError";
    this.report = report;
  }
}
