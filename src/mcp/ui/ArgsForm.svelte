<script lang="ts">
  import { untrack } from "svelte";
  import type { Tool } from "@modelcontextprotocol/client";

  // Generates an arguments form straight from a tool's advertised `inputSchema` (the JSON Schema the
  // server actually publishes over `tools/list`) rather than hand-coding one field list per tool.
  // Scoped to the shapes these two tools' schemas actually use — string (optionally enum), boolean,
  // number, and one level of nested object (`config`) — not a general JSON-Schema-to-form renderer.

  interface JsonSchemaProp {
    type?: string;
    enum?: readonly string[];
    default?: unknown;
    properties?: Record<string, JsonSchemaProp>;
    /** Zod's `.meta({ title })` / `.describe()` output (see src/mcp/schemas.ts) — when present, the
     *  field's label and a small hint beneath it, so a schema-driven control reads the same as its
     *  hand-written equivalent on the Configure page. */
    title?: string;
    description?: string;
  }

  let {
    tool,
    omit = [],
    initial = {},
    onsubmit,
  }: {
    tool: Tool;
    /** Field names not to render (e.g. `demo`/`documents`, which the page's source strip supplies). */
    omit?: string[];
    /** Seed values overriding the schema-derived defaults (e.g. the current view's own config). */
    initial?: Record<string, unknown>;
    onsubmit: (args: Record<string, unknown>, opts: { requestProgress: boolean }) => void;
  } = $props();

  function properties(t: Tool): [string, JsonSchemaProp][] {
    const schema = t.inputSchema as { properties?: Record<string, JsonSchemaProp> } | undefined;
    return Object.entries(schema?.properties ?? {}).filter(([key]) => !omit.includes(key));
  }

  function defaultFor(prop: JsonSchemaProp): unknown {
    if (prop.default !== undefined) return prop.default;
    if (prop.type === "boolean") return false;
    if (prop.enum && prop.enum.length > 0) return prop.enum[0];
    return "";
  }

  function initialValues(t: Tool): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const [key, prop] of properties(t)) {
      if (prop.type === "object") {
        const nested: Record<string, unknown> = {};
        for (const [nKey, nProp] of Object.entries(prop.properties ?? {})) {
          nested[nKey] = defaultFor(nProp);
        }
        values[key] = nested;
      } else {
        values[key] = defaultFor(prop);
      }
    }
    return { ...values, ...initial };
  }

  // Seeded once at mount rather than derived: the fields edit these values in place, which a plain
  // $derived cannot be. McpPage remounts under `{#key selectedTool.name}` when the tool changes, so
  // that remount — not reactivity in here — is what keeps the form in step with the schema.
  // `untrack` states that read-once intent, so reading a prop here isn't mistaken for a lost
  // dependency.
  let values = $state<Record<string, unknown>>(untrack(() => initialValues(tool)));
  let requestProgress = $state(true);

  function nested(key: string): Record<string, unknown> {
    return values[key] as Record<string, unknown>;
  }

  /** A field's visible label: the schema's title when the server supplied one, else its raw
   *  property name (every field had only the raw name before schemas.ts started titling them). */
  function labelFor(key: string, prop: JsonSchemaProp): string {
    return prop.title ?? key;
  }

  function handleSubmit(e: SubmitEvent): void {
    e.preventDefault();
    onsubmit($state.snapshot(values), { requestProgress });
  }
</script>

<form class="args-form" onsubmit={handleSubmit}>
  {#each properties(tool) as [key, prop] (key)}
    {#if prop.type === "object"}
      <fieldset class="args-group">
        <legend>{labelFor(key, prop)}</legend>
        {#if prop.description}<p class="args-hint">{prop.description}</p>{/if}
        {#each Object.entries(prop.properties ?? {}) as [nKey, nProp] (nKey)}
          <label class="args-label">
            <span>{labelFor(nKey, nProp)}</span>
            {#if nProp.description}<span class="args-hint">{nProp.description}</span>{/if}
            {#if nProp.enum}
              <select
                value={nested(key)[nKey]}
                onchange={(e) => (nested(key)[nKey] = (e.target as HTMLSelectElement).value)}
              >
                {#each nProp.enum as opt (opt)}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            {:else}
              <input
                type="text"
                value={nested(key)[nKey]}
                oninput={(e) => (nested(key)[nKey] = (e.target as HTMLInputElement).value)}
              />
            {/if}
          </label>
        {/each}
      </fieldset>
    {:else if prop.type === "boolean"}
      <label class="args-label args-checkbox">
        <input
          type="checkbox"
          checked={values[key] as boolean}
          onchange={(e) => (values[key] = (e.target as HTMLInputElement).checked)}
        />
        <span>{labelFor(key, prop)}</span>
        {#if prop.description}<span class="args-hint">{prop.description}</span>{/if}
      </label>
    {:else if prop.enum}
      <label class="args-label">
        <span>{labelFor(key, prop)}</span>
        {#if prop.description}<span class="args-hint">{prop.description}</span>{/if}
        <select
          value={values[key]}
          onchange={(e) => (values[key] = (e.target as HTMLSelectElement).value)}
        >
          {#each prop.enum as opt (opt)}
            <option value={opt}>{opt}</option>
          {/each}
        </select>
      </label>
    {:else if prop.type === "number" || prop.type === "integer"}
      <label class="args-label">
        <span>{labelFor(key, prop)}</span>
        {#if prop.description}<span class="args-hint">{prop.description}</span>{/if}
        <input
          type="number"
          value={values[key]}
          oninput={(e) => (values[key] = (e.target as HTMLInputElement).valueAsNumber)}
        />
      </label>
    {:else}
      <label class="args-label">
        <span>{labelFor(key, prop)}</span>
        {#if prop.description}<span class="args-hint">{prop.description}</span>{/if}
        <input
          type="text"
          value={values[key]}
          oninput={(e) => (values[key] = (e.target as HTMLInputElement).value)}
        />
      </label>
    {/if}
  {/each}

  <label class="args-label args-checkbox args-progress">
    <input type="checkbox" bind:checked={requestProgress} />
    <span>Request progress</span>
  </label>

  <button type="submit" class="args-submit">Call {tool.title ?? tool.name}</button>
</form>
