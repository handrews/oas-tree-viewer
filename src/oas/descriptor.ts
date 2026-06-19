// A declarative model of the OAS object grammar, used by the classifier to assign
// a semantic type to each object/array/map node. Only fields that *contain* typed
// objects, arrays, or maps are listed; scalar/free-form fields are left generic.
//
// Reference detection ($ref) is handled in the classifier, not here: outside of
// Schema Objects, an object bearing a `$ref` is a Reference Object regardless of
// the position's declared type.

import type { NodeCategory } from "../types";
import type { VersionFamily } from "../types";

/** Name of a type in the descriptor registry. */
export type TypeRef = string;

/** How a named field holds its typed child/children. Exactly one key is present. */
export type FieldRule =
  | { value: TypeRef } // a single object of this type
  | { array: TypeRef } // an array whose elements are this type
  | { map: TypeRef }; // a map (object) whose values are this type

export interface TypeDescriptor {
  /** Display label, e.g. "Operation Object". */
  label: string;
  /** Coloring bucket. */
  category: NodeCategory;
  /** Fixed (named) fields. */
  fields?: Record<string, FieldRule>;
  /** Type of patterned/map values (keys not covered by `fields`). */
  mapOf?: TypeRef;
}

export type Descriptors = Record<TypeRef, TypeDescriptor>;

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/** Build the type registry for the given OAS version family. */
export function buildDescriptors(version: VersionFamily): Descriptors {
  const pathItemFields: Record<string, FieldRule> = {
    servers: { array: "Server" },
    parameters: { array: "Parameter" },
  };
  for (const method of HTTP_METHODS) pathItemFields[method] = { value: "Operation" };

  const componentsFields: Record<string, FieldRule> = {
    schemas: { map: "Schema" },
    responses: { map: "Response" },
    parameters: { map: "Parameter" },
    examples: { map: "Example" },
    requestBodies: { map: "RequestBody" },
    headers: { map: "Header" },
    securitySchemes: { map: "SecurityScheme" },
    links: { map: "Link" },
    callbacks: { map: "Callback" },
    pathItems: { map: "PathItem" },
  };

  // OAS 3.2 additions.
  if (version === "3.2") {
    pathItemFields.query = { value: "Operation" };
    pathItemFields.additionalOperations = { map: "Operation" };
    componentsFields.mediaTypes = { map: "MediaType" };
  }

  return {
    OpenApi: {
      label: "OpenAPI Object",
      category: "structural",
      fields: {
        info: { value: "Info" },
        servers: { array: "Server" },
        paths: { value: "Paths" },
        webhooks: { map: "PathItem" },
        components: { value: "Components" },
        security: { array: "SecurityRequirement" },
        tags: { array: "Tag" },
        externalDocs: { value: "ExternalDocs" },
      },
    },

    Info: {
      label: "Info Object",
      category: "metadata",
      fields: { contact: { value: "Contact" }, license: { value: "License" } },
    },
    Contact: { label: "Contact Object", category: "metadata" },
    License: { label: "License Object", category: "metadata" },
    Server: {
      label: "Server Object",
      category: "http",
      fields: { variables: { map: "ServerVariable" } },
    },
    ServerVariable: { label: "Server Variable Object", category: "data" },
    ExternalDocs: { label: "External Documentation Object", category: "metadata" },
    Tag: {
      label: "Tag Object",
      category: "metadata",
      fields: { externalDocs: { value: "ExternalDocs" } },
    },

    Paths: { label: "Paths Object", category: "http", mapOf: "PathItem" },
    PathItem: { label: "Path Item Object", category: "http", fields: pathItemFields },

    Operation: {
      label: "Operation Object",
      category: "http",
      fields: {
        externalDocs: { value: "ExternalDocs" },
        parameters: { array: "Parameter" },
        requestBody: { value: "RequestBody" },
        responses: { value: "Responses" },
        callbacks: { map: "Callback" },
        security: { array: "SecurityRequirement" },
        servers: { array: "Server" },
      },
    },

    Components: { label: "Components Object", category: "structural", fields: componentsFields },

    Responses: {
      label: "Responses Object",
      category: "http",
      fields: { default: { value: "Response" } },
      mapOf: "Response",
    },
    Response: {
      label: "Response Object",
      category: "http",
      fields: {
        headers: { map: "Header" },
        content: { map: "MediaType" },
        links: { map: "Link" },
      },
    },

    Parameter: {
      label: "Parameter Object",
      category: "http",
      fields: {
        schema: { value: "Schema" },
        content: { map: "MediaType" },
        examples: { map: "Example" },
      },
    },
    RequestBody: {
      label: "Request Body Object",
      category: "http",
      fields: { content: { map: "MediaType" } },
    },
    MediaType: {
      label: "Media Type Object",
      category: "data",
      fields: {
        schema: { value: "Schema" },
        examples: { map: "Example" },
        encoding: { map: "Encoding" },
      },
    },
    Encoding: {
      label: "Encoding Object",
      category: "data",
      fields: { headers: { map: "Header" } },
    },
    Header: {
      label: "Header Object",
      category: "http",
      fields: {
        schema: { value: "Schema" },
        content: { map: "MediaType" },
        examples: { map: "Example" },
      },
    },
    Example: { label: "Example Object", category: "data" },

    Callback: { label: "Callback Object", category: "http", mapOf: "PathItem" },
    Link: { label: "Link Object", category: "http", fields: { server: { value: "Server" } } },

    SecurityRequirement: { label: "Security Requirement Object", category: "security" },
    SecurityScheme: {
      label: "Security Scheme Object",
      category: "security",
      fields: { flows: { value: "OAuthFlows" } },
    },
    OAuthFlows: {
      label: "OAuth Flows Object",
      category: "security",
      fields: {
        implicit: { value: "OAuthFlow" },
        password: { value: "OAuthFlow" },
        clientCredentials: { value: "OAuthFlow" },
        authorizationCode: { value: "OAuthFlow" },
      },
    },
    OAuthFlow: { label: "OAuth Flow Object", category: "security" },

    // Schema Object (JSON Schema 2020-12 + OAS vocabulary). Recursive.
    Schema: {
      label: "Schema Object",
      category: "data",
      fields: {
        properties: { map: "Schema" },
        patternProperties: { map: "Schema" },
        $defs: { map: "Schema" },
        dependentSchemas: { map: "Schema" },
        items: { value: "Schema" },
        additionalProperties: { value: "Schema" },
        unevaluatedProperties: { value: "Schema" },
        unevaluatedItems: { value: "Schema" },
        contains: { value: "Schema" },
        propertyNames: { value: "Schema" },
        not: { value: "Schema" },
        if: { value: "Schema" },
        then: { value: "Schema" },
        else: { value: "Schema" },
        allOf: { array: "Schema" },
        anyOf: { array: "Schema" },
        oneOf: { array: "Schema" },
        prefixItems: { array: "Schema" },
        externalDocs: { value: "ExternalDocs" },
        discriminator: { value: "Discriminator" },
        xml: { value: "Xml" },
      },
    },
    Discriminator: { label: "Discriminator Object", category: "data" },
    Xml: { label: "XML Object", category: "data" },
  };
}
