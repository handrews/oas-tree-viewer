<script lang="ts">
  // Side panel: a category legend plus details for the currently selected node,
  // including the reference edges that touch it. Svelte auto-escapes interpolated
  // text, so untrusted values (keys, scalars, refs) are safe by construction.
  import type { OadDocument, TreeNode } from "../types";
  import { displayPointer } from "../model/jsonPointer";
  import { descendantCount } from "../model/treeBuilder";
  import {
    docName,
    baseUri,
    docVersionLabel,
    formatScalar,
    outgoingRefs,
    incomingRefs,
    type DetailContext,
  } from "./detail";

  let {
    selected,
    ctx,
  }: {
    selected: { doc: OadDocument; node: TreeNode } | null;
    ctx: DetailContext | null;
  } = $props();
</script>

{#if selected}
  {@const doc = selected.doc}
  {@const node = selected.node}
  <section class="node-detail">
    <h2>Selected node</h2>
    <dl class="detail-grid">
      <dt>Document</dt>
      <dd>
        {docName(doc)} <span class="dim">· {docVersionLabel(doc)}</span>{#if doc.isEntry}
          <span class="pill">entry</span>{/if}
      </dd>

      <dt>Pointer</dt>
      <dd><code>{displayPointer(node.id)}</code></dd>

      <dt>OAS type</dt>
      <dd>
        {#if node.oasType}{node.oasType}{:else}<em>generic</em>{/if}
      </dd>

      <dt>Value kind</dt>
      <dd>{node.valueKind}</dd>

      {#if node.valueKind === "object" || node.valueKind === "array"}
        <dt>Children</dt>
        <dd>{node.children.length} direct · {descendantCount(node)} total</dd>
      {:else}
        <dt>Value</dt>
        <dd><code>{formatScalar(node.scalarValue)}</code></dd>
      {/if}

      {#if baseUri(doc)}
        <dt>Base URI</dt>
        <dd>
          <code>{baseUri(doc)}</code>{#if doc.selfUri}
            ($self){/if}
        </dd>
      {/if}
    </dl>

    {#if node.dialectResolutionWarning}
      <div class="ref-note advisory severity-warning">{node.dialectResolutionWarning}</div>
    {/if}

    {#each node.resolutionAdvisories ?? [] as advisory (advisory.code)}
      <div class="ref-note advisory severity-warning">{advisory.detail}</div>
    {/each}

    {#if ctx}
      {@const c = ctx}
      {@const out = outgoingRefs(c.refs, doc.id, node.id)}
      {@const inc = incomingRefs(c.refs, doc.id, node.id)}
      {#if out.length}
        <div class="ref-section">
          <h3>Resolves to →</h3>
          {#each out as e (e.id)}
            <div class="ref-item">
              <span class="ref-badge {e.status}">{e.status}</span>
              {#if e.targetDocId && e.targetNodeId}
                {@const targetDocId = e.targetDocId}
                {@const targetNodeId = e.targetNodeId}
                <button
                  type="button"
                  class="nav-ref"
                  onclick={() => c.onNavigate(targetDocId, targetNodeId)}
                >
                  {c.docLabel(targetDocId)} <code>{displayPointer(targetNodeId)}</code>
                </button>
                {#if e.status === "type-mismatch"}
                  <div class="ref-note">
                    expected <strong>{e.requiredType}</strong>, found
                    <strong>{e.targetType ?? "?"}</strong>
                  </div>
                {/if}
                {#if e.resolution === "dynamic"}
                  <div class="ref-note">
                    tentative — the actual target depends on the evaluation path
                  </div>
                {/if}
                {#each e.diagnostics ?? [] as d (d.code)}
                  <div class="ref-note advisory severity-{d.severity}">{d.detail}</div>
                {/each}
              {:else}
                <code>{e.refString}</code>
                <div class="ref-note">
                  {#if e.status === "external"}
                    target document not loaded
                  {:else if e.resolution === "operation-id"}
                    no Operation declares this operationId
                  {:else}
                    fragment not found
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
      {#if inc.length}
        <div class="ref-section">
          <h3>Referenced by ←</h3>
          {#each inc as e (e.id)}
            <div class="ref-item">
              <span class="ref-badge {e.status}">{e.status}</span>
              <button
                type="button"
                class="nav-ref"
                onclick={() => c.onNavigate(e.sourceDocId, e.sourceObjectId)}
              >
                {c.docLabel(e.sourceDocId)} <code>{displayPointer(e.sourceObjectId)}</code>
              </button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </section>
{:else}
  <section class="node-detail empty">
    <p class="hint">
      Click a node's label to inspect it. Click a node's dot to expand or collapse.
    </p>
  </section>
{/if}
