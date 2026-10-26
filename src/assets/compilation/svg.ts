import { CompileError } from "./errors";

// SVG inputs are RigLab and MapLab art: self-contained vector documents. Anything that reaches outside the document
// (scripts, external or embedded resources, entities, foreign HTML) is refused, both because it is unsafe and because
// it would make the raster depend on more than the source bytes.

export const SVG_LIMITS = Object.freeze({ maxSourceBytes: 1_048_576, maxDimension: 4096 });

/** One source ready to rasterize: the document at its raster size, with its source size kept for the manifest. */
export interface PreparedSvg {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

const UNSAFE: readonly [RegExp, string][] = [
  [/<!(?:DOCTYPE|ENTITY)/i, "document type declarations and entities"],
  [/<\s*(?:[\w-]+:)?script\b/i, "scripts"],
  [/<\s*(?:[\w-]+:)?foreignObject\b/i, "foreignObject"],
  [/<\s*(?:[\w-]+:)?(?:image|feImage)\b/i, "embedded or external images"],
  [/\son[a-z]+\s*=/i, "event handler attributes"],
  [/@import\b/i, "stylesheet imports"],
  [/\bhref\s*=\s*(?!["']\s*#)/i, "references outside the document"],
  [/url\(\s*(?!["']?\s*#)/i, "url() references outside the document"],
];

const ROOT = /<svg\b([^>]*)>/;
const LENGTH = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/;

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`).exec(attributes);
  return match ? match[2] : null;
}

function length(value: string | null): number | null {
  const match = value === null ? null : LENGTH.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * Validates one SVG source and rewrites its root to the raster size `scale` gives. The source size is the root's
 * width and height, or its viewBox size when they are absent. The raster size must be a whole number of pixels, so a
 * pixel-art source maps onto the pixel grid exactly.
 */
export function prepareSvg(source: string, scale: number, at: string): PreparedSvg {
  if (new TextEncoder().encode(source).length > SVG_LIMITS.maxSourceBytes) {
    throw new CompileError("svg.size", at, `source exceeds ${SVG_LIMITS.maxSourceBytes} bytes`);
  }
  for (const [pattern, what] of UNSAFE) {
    if (pattern.test(source)) throw new CompileError("svg.unsafe", at, `SVG sources may not contain ${what}`);
  }
  const root = ROOT.exec(source);
  if (!root || source.slice(0, root.index).replace(/<\?xml[^>]*\?>|<!--[\s\S]*?-->/g, "").trim()) {
    throw new CompileError("svg.root", at, "the document must start with an <svg> root element");
  }
  const attributes = root[1].replace(/\/$/, "");
  const viewBox = attribute(attributes, "viewBox")?.trim().split(/[\s,]+/).map(Number) ?? null;
  if (viewBox && (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0)) {
    throw new CompileError("svg.root", at, "viewBox must be four numbers with a positive width and height");
  }
  const sourceWidth = length(attribute(attributes, "width")) ?? viewBox?.[2] ?? null;
  const sourceHeight = length(attribute(attributes, "height")) ?? viewBox?.[3] ?? null;
  if (!sourceWidth || !sourceHeight) {
    throw new CompileError("svg.root", at, "the root needs pixel width and height attributes or a viewBox");
  }
  if (!Number.isFinite(scale) || scale <= 0) throw new CompileError("atlas.settings", "scale", "scale must be a positive number");
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new CompileError("svg.size", at, `scale ${scale} gives ${width}×${height}, not a whole number of pixels`);
  }
  if (width > SVG_LIMITS.maxDimension || height > SVG_LIMITS.maxDimension) {
    throw new CompileError("svg.size", at, `${width}×${height} exceeds ${SVG_LIMITS.maxDimension} pixels`);
  }
  let rewritten = attributes.replace(/\s(?:width|height)\s*=\s*(["']).*?\1/g, "");
  if (!viewBox) rewritten += ` viewBox="0 0 ${sourceWidth} ${sourceHeight}"`;
  if (attribute(attributes, "xmlns") === null) rewritten += ' xmlns="http://www.w3.org/2000/svg"';
  const tag = `<svg${rewritten} width="${width}" height="${height}"${root[1].endsWith("/") ? "/" : ""}>`;
  const svg = source.slice(0, root.index) + tag + source.slice(root.index + root[0].length);
  return { svg, width, height, sourceWidth, sourceHeight };
}
