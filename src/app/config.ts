// Viewer configuration: the implementation-defined resolution choices the OAS leaves open
// (SHOULD / version-conditional behavior). Pure and framework-free so it is node-testable;
// encoded into the /view URL (non-defaults only) so a configured view stays bookmarkable.

export interface ViewerConfig {
  /**
   * Discriminator `mapping` value: prefer the component name (default) or the URI-reference.
   * - "name-first": a Schema component if one matches, else a URI-reference.
   * - "uri-first": a URI-reference if it resolves, else a Schema component name.
   */
  mappingPrecedence: "name-first" | "uri-first";
  /**
   * Where a component name is looked up (applies to `mapping` and Security Requirement):
   * the entry document's Components (default) or the local document's.
   */
  componentLookup: "entry" | "local";
}

export const defaultConfig: ViewerConfig = {
  mappingPrecedence: "name-first",
  componentLookup: "entry",
};

/** Parse config from URL params, falling back to a default for any absent/unrecognized value. */
export function parseConfig(params: URLSearchParams): ViewerConfig {
  return {
    mappingPrecedence: params.get("disc") === "uri-first" ? "uri-first" : "name-first",
    componentLookup: params.get("lookup") === "local" ? "local" : "entry",
  };
}

/** Encode only the non-default choices, so a default view keeps a clean URL. */
export function configParams(config: ViewerConfig): URLSearchParams {
  const params = new URLSearchParams();
  if (config.mappingPrecedence !== defaultConfig.mappingPrecedence) {
    params.set("disc", config.mappingPrecedence);
  }
  if (config.componentLookup !== defaultConfig.componentLookup) {
    params.set("lookup", config.componentLookup);
  }
  return params;
}
