// Walk a document's structural tree and assign each node an OAS semantic type,
// a coloring category, and reference metadata. Starts from the OpenAPI Object root.

import type { TreeNode, NodeCategory, VersionFamily } from "../types";
import {
  buildDescriptors,
  type Descriptors,
  type TypeRef,
  type FieldRule,
  type TypeDescriptor,
} from "./descriptor";

const REF_KEY = "$ref";

/** Classify a whole document in place. `root` must be the OpenAPI Object. */
export function classifyDocument(root: TreeNode, version: VersionFamily): void {
  visitValue(root, "OpenApi", buildDescriptors(version));
}

/** A node expected to be a single object of `typeRef` (or a Reference Object). */
function visitValue(node: TreeNode, typeRef: TypeRef, d: Descriptors): void {
  // Record the slot's expected type before anything else, so a Reference Object here
  // inherits the type it stands in for (used by reference type-compatibility checks).
  node.expectedType = typeRef;

  const isSchema = typeRef === "Schema";
  const ref = node.valueKind === "object" ? refStringOf(node) : undefined;

  if (ref !== undefined) {
    node.isReference = true;
    node.refTarget = ref;
    if (!isSchema) {
      // A pure Reference Object: its only meaningful children are scalars.
      node.oasType = "Reference Object";
      node.category = "reference";
      classifyGeneric(node);
      return;
    }
    // Schema with `$ref`: in JSON Schema `$ref` is a keyword and may have siblings,
    // so keep classifying this node as a Schema below (still flagged isReference).
  }

  const desc = d[typeRef];
  if (desc && node.valueKind === "object") {
    node.oasType = desc.label;
    node.category = desc.category;
    classifyObjectChildren(node, desc, d);
  } else {
    // The value isn't the object we expected (e.g. boolean `additionalProperties`,
    // or an unknown type): fall back to structural typing.
    assignStructural(node);
    classifyGeneric(node);
  }
}

/** A node expected to be an array of `elemType`. */
function visitArray(node: TreeNode, elemType: TypeRef, d: Descriptors): void {
  if (node.valueKind !== "array") {
    assignStructural(node);
    classifyGeneric(node);
    return;
  }
  node.oasType = `Array of ${labelOf(elemType, d)}`;
  node.category = "array";
  for (const element of node.children) visitValue(element, elemType, d);
}

/** A node expected to be a map (object) whose values are `valueType`. */
function visitMap(node: TreeNode, valueType: TypeRef, d: Descriptors): void {
  if (node.valueKind !== "object") {
    assignStructural(node);
    classifyGeneric(node);
    return;
  }
  node.oasType = `Map of ${labelOf(valueType, d)}`;
  node.category = "structure";
  for (const value of node.children) visitValue(value, valueType, d);
}

function classifyObjectChildren(node: TreeNode, desc: TypeDescriptor, d: Descriptors): void {
  for (const child of node.children) {
    const rule = child.key !== null ? desc.fields?.[child.key] : undefined;
    if (rule) {
      applyRule(child, rule, d);
    } else if (desc.mapOf) {
      visitValue(child, desc.mapOf, d);
    } else {
      // Extension fields (x-*) and anything off-grammar: keep, but type generically.
      assignStructural(child);
      classifyGeneric(child);
    }
  }
}

function applyRule(node: TreeNode, rule: FieldRule, d: Descriptors): void {
  if ("value" in rule) visitValue(node, rule.value, d);
  else if ("array" in rule) visitArray(node, rule.array, d);
  else visitMap(node, rule.map, d);
}

/** Recursively assign structural categories to a node's descendants. */
function classifyGeneric(node: TreeNode): void {
  for (const child of node.children) {
    if (!child.category) assignStructural(child);
    classifyGeneric(child);
  }
}

function assignStructural(node: TreeNode): void {
  node.category = structuralCategory(node);
}

function structuralCategory(node: TreeNode): NodeCategory {
  if (node.valueKind === "object") return "object";
  if (node.valueKind === "array") return "array";
  return "scalar";
}

function labelOf(typeRef: TypeRef, d: Descriptors): string {
  return d[typeRef]?.label ?? typeRef;
}

/** If `node` is a Reference Object, return its `$ref` string; else undefined. */
function refStringOf(node: TreeNode): string | undefined {
  const refChild = node.children.find((c) => c.key === REF_KEY);
  if (refChild && refChild.valueKind === "string") {
    return refChild.scalarValue as string;
  }
  return undefined;
}
