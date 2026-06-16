// Core domain types shared across the model, classifier, and render layers.

/** The JSON value categories a node can hold. */
export type ValueKind =
  | "object"
  | "array"
  | "string"
  | "number"
  | "boolean"
  | "null";

/**
 * Coarse semantic bucket used for node coloring. OAS object types map onto these;
 * unclassified structure falls back to "object" / "array" / "scalar".
 */
export type NodeCategory =
  | "root"
  | "structure"
  | "operation"
  | "schema"
  | "io"
  | "meta"
  | "security"
  | "reference"
  | "object"
  | "array"
  | "scalar";

/**
 * A single node in a document's parent/child tree.
 *
 * `id` is the node's JSON Pointer (RFC 6901) *within its own document*. It is the
 * stable address the future reference resolver will use to point a `$ref` at its
 * target node (possibly in another document).
 */
export interface TreeNode {
  /** JSON Pointer from the document root, e.g. "/paths/~1pets/get". Root is "". */
  id: string;
  /** Property name or array index connecting this node to its parent; null at root. */
  key: string | null;
  keyKind: "root" | "property" | "index";
  valueKind: ValueKind;
  /** Semantic OAS type label, set by the classifier (e.g. "Operation Object"). */
  oasType?: string;
  /**
   * The grammar type expected at this node's slot (e.g. "Operation", "Parameter",
   * "Schema"), set by the classifier. A Reference Object inherits the expected type of
   * the slot it occupies, so this — not `oasType` — drives reference type-compatibility.
   */
  expectedType?: string;
  /** Coarse coloring bucket, set by the classifier (defaults to a structural bucket). */
  category?: NodeCategory;
  /** True when this object is a Reference Object (contains a `$ref`). */
  isReference?: boolean;
  /** Raw `$ref` string, retained for future reference resolution. */
  refTarget?: string;
  /** The scalar value, for leaf nodes only. */
  scalarValue?: string | number | boolean | null;
  children: TreeNode[];
}

/** The two OAS version families this tool understands. */
export type VersionFamily = "3.1" | "3.2";

export type DocSource = "upload" | "url";

/**
 * One validated OpenAPI document within an OAD, together with its parsed value,
 * structural/typed tree, and the metadata needed for (future) reference resolution.
 */
export interface OadDocument {
  /** Stable per-document id, used for the canvas group and future cross-doc edges. */
  id: string;
  /** Exactly one document in an OAD is the entry document. */
  isEntry: boolean;
  source: DocSource;
  filename?: string;
  /** Base URI: for a URL source this is the fetch URL; for an upload, optional/user-set. */
  retrievalUri?: string;
  /** Value of the `$self` field if present (OAS 3.2), part of base-URI resolution. */
  selfUri?: string;
  format: "json" | "yaml";
  raw: string;
  value: unknown;
  /** The root `openapi` version string, e.g. "3.1.0". Always present (non-OAS = error). */
  oasVersion: string;
  root: TreeNode;
}

/** A complete OpenAPI Description: an entry document plus any referenced documents. */
export interface Oad {
  /** Entry document first by convention. */
  documents: OadDocument[];
  versionFamily: VersionFamily;
}
