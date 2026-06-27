import type { VersionFamily } from "../types";
import type { ReferenceEdge } from "./types";
import type { ViewerConfig } from "../app/config";
import type { ComponentSpec, Indexes, RefSource } from "./indexer";
import { resolveUriRef } from "./uriRef";

export interface ResolveCtx {
  entryDocId: string;
  config: ViewerConfig;
  version: VersionFamily;
}

/**
 * Resolve a Discriminator `mapping` value / Security Requirement key, which is either a
 * component name or a URI-reference. Precedence (confirmed rules):
 *  - Security Requirement, 3.1: always a component name (no URI fallback).
 *  - Security Requirement, 3.2: component name if a match exists, else URI-reference.
 *  - `mapping`, name-first (default): component name if a match exists, else URI-reference.
 *  - `mapping`, uri-first (config): URI-reference if it locates a target, else component name.
 * The "match" is looked up in the entry document's Components (default) or the local doc's.
 */
export function resolveComponentEdge(
  base: ReferenceEdge,
  src: RefSource,
  spec: ComponentSpec,
  indexes: Indexes,
  ctx: ResolveCtx,
): ReferenceEdge {
  const key = spec.expectedType === "Schema" ? "schemas" : "securitySchemes";
  const lookupDocId = ctx.config.componentLookup === "entry" ? ctx.entryDocId : src.doc.id;
  const nameTarget = indexes.pointerIndex
    .get(lookupDocId)
    ?.get(`/components/${key}/${src.refString}`);

  const asName = (): ReferenceEdge =>
    nameTarget
      ? {
          ...base,
          resolution: "component-name",
          status: "resolved",
          targetDocId: lookupDocId,
          targetNodeId: nameTarget.id,
          targetType: spec.expectedType,
        }
      : { ...base, resolution: "component-name", status: "broken" };

  const asUri = (): ReferenceEdge => ({
    ...base,
    resolution: "uri-reference",
    ...resolveUriRef(src.refString, src.base, spec.expectedType, indexes),
  });

  if (spec.field === "securityRequirement") {
    // 3.0 and 3.1: a Security Requirement key is always a component name (no URI form). 3.2 adds the
    // URI-reference fallback when no component matches.
    if (ctx.version !== "3.2") return asName();
    return nameTarget ? asName() : asUri();
  }

  if (ctx.config.mappingPrecedence === "name-first") {
    return nameTarget ? asName() : asUri();
  }
  const uri = asUri();
  if (uri.status === "resolved" || uri.status === "type-mismatch") return uri;
  return nameTarget ? asName() : uri;
}
