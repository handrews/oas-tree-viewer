// Parse a document as JSON or YAML, labelling which format actually succeeded.
// YAML is a superset of JSON, so the YAML parser accepts both; we try JSON first
// (cheaper, and lets us label pure-JSON documents accurately) then fall back.

import { parse as parseYaml } from "yaml";
import { ParseError, errorMessage } from "../errors";

export interface ParsedDoc {
  value: unknown;
  format: "json" | "yaml";
}

function extensionOf(filename: string | undefined): string | null {
  if (!filename) return null;
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Parse document text, using a filename hint only to pick the better error message.
 * Throws {@link ParseError} when the text is neither valid JSON nor valid YAML.
 */
export function parseDocument(text: string, filename?: string): ParsedDoc {
  const ext = extensionOf(filename);

  if (ext === "json") {
    try {
      return { value: JSON.parse(text), format: "json" };
    } catch (e) {
      throw new ParseError(`Invalid JSON: ${errorMessage(e)}`);
    }
  }

  if (ext === "yaml" || ext === "yml") {
    try {
      return { value: parseYaml(text), format: "yaml" };
    } catch (e) {
      throw new ParseError(`Invalid YAML: ${errorMessage(e)}`);
    }
  }

  // Unknown/absent extension: prefer a clean JSON parse, otherwise try YAML.
  try {
    return { value: JSON.parse(text), format: "json" };
  } catch {
    /* not JSON — try YAML below */
  }
  try {
    return { value: parseYaml(text), format: "yaml" };
  } catch (e) {
    throw new ParseError(`Could not parse as JSON or YAML: ${errorMessage(e)}`);
  }
}
