// Compilation refusals carry stable codes like bundle refusals do, so callers and tests match codes, never wording.
export type CompileErrorCode =
  | "svg.root"
  | "svg.size"
  | "svg.unsafe"
  | "raster.shape"
  | "atlas.id"
  | "atlas.duplicate"
  | "atlas.settings"
  | "atlas.too-large";

/** A refused compilation input, naming the source ID or setting at fault. */
export class CompileError extends Error {
  readonly code: CompileErrorCode;
  readonly at: string | null;

  constructor(code: CompileErrorCode, at: string | null, message: string) {
    super(at === null ? `${code}: ${message}` : `${code} at ${at}: ${message}`);
    this.name = "CompileError";
    this.code = code;
    this.at = at;
  }
}
