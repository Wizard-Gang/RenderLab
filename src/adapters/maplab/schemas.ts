import type { JsonValue } from "../../assets";
import catalog from "../../../fixtures/maplab/schemas/maplab.catalog.v1.schema.json";
import exportSchema from "../../../fixtures/maplab/schemas/maplab.export.v1.schema.json";
import map from "../../../fixtures/maplab/schemas/maplab.map.v1.schema.json";
import movement from "../../../fixtures/maplab/schemas/maplab.movement.v1.schema.json";
import navigation from "../../../fixtures/maplab/schemas/maplab.navigation.v1.schema.json";
import prefab from "../../../fixtures/maplab/schemas/maplab.prefab.v1.schema.json";
import tileset from "../../../fixtures/maplab/schemas/maplab.tileset.v1.schema.json";
import type { MapLabFormat } from "./contracts";
import { compileSchema, type CompiledSchema } from "./schema";

// MapLab's published schemas, read from the byte-exact copies fixtures/provenance.json pins to a MapLab commit. They
// are data, not MapLab code: the adapter compiles them with its own evaluator.

const DOCUMENT_SCHEMAS: Readonly<Record<MapLabFormat, JsonValue>> = {
  "maplab.map": map as unknown as JsonValue,
  "maplab.tileset": tileset as unknown as JsonValue,
  "maplab.prefab": prefab as unknown as JsonValue,
  "maplab.catalog": catalog as unknown as JsonValue,
  "maplab.movement": movement as unknown as JsonValue,
  "maplab.navigation": navigation as unknown as JsonValue,
};

/** Bundled `schema` files may only be these pinned schemas, unchanged. */
export const PINNED_SCHEMAS: ReadonlyMap<string, JsonValue> = new Map([
  ...Object.entries(DOCUMENT_SCHEMAS).map(([format, schema]) => [`schemas/${format}.v1.schema.json`, schema] as const),
  ["schemas/maplab.export.v1.schema.json", exportSchema as unknown as JsonValue],
]);

const compiled = new Map<MapLabFormat, CompiledSchema>();

export function documentSchema(format: MapLabFormat): CompiledSchema {
  let schema = compiled.get(format);
  if (!schema) {
    schema = compileSchema(DOCUMENT_SCHEMAS[format], `${format}.v1.schema.json`);
    compiled.set(format, schema);
  }
  return schema;
}
