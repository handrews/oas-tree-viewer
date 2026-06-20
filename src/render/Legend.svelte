<script lang="ts">
  // Collapsible legend explaining the diagram's colors (semantic object groups), node-marker
  // shapes, the two reference styles (URI-reference vs component name), the collapsed-line
  // state, error-icon colors, and the unreachable-document warning. All data comes from
  // colors.ts so the legend and the renderer can't drift.
  import {
    categoryClass,
    categoryLabel,
    legendGroups,
    shapeLegend,
    referenceLegend,
    lineLegend,
    errorIconLegend,
    warningLegend,
  } from "./colors";

  const markerGlyph = (shape: string): string => (shape === "diamond" ? "◆" : "✱");
</script>

<details class="legend" open>
  <summary>Legend</summary>
  <div class="legend-body">
    <h4>Object groups</h4>
    <ul class="legend-list">
      {#each legendGroups as cat (cat)}
        <li>
          <span class="swatch shape-circle {categoryClass(cat)}"></span>{categoryLabel[cat]}
        </li>
      {/each}
    </ul>

    <h4>Node shapes</h4>
    <ul class="legend-list">
      {#each shapeLegend as s (s.shape)}
        <li>
          <span class="legend-shape shape-{s.shape}"></span>
          {s.label}
        </li>
      {/each}
    </ul>

    <h4>References</h4>
    <ul class="legend-list">
      {#each referenceLegend as r (r.kind)}
        <li>
          <span class="legend-shape shape-{r.marker}">{markerGlyph(r.marker)}</span>
          <span class="ref-sample">
            <span class="legend-line line-{r.line}"></span>
            <span class="ref-arrow-sample" aria-hidden="true">{r.arrowhead === "open" ? "▷" : "▶"}</span>
          </span>
          {r.label}
        </li>
      {/each}
    </ul>

    <h4>Connection lines</h4>
    <ul class="legend-list">
      {#each lineLegend as l (l.variant)}
        <li>
          <span class="legend-line line-dashed" class:line-error={l.variant === "type-mismatch"}></span>
          {l.label}
        </li>
      {/each}
    </ul>

    <h4>Error icons</h4>
    <ul class="legend-list">
      {#each errorIconLegend as e (e.status)}
        <li><span class="legend-warn status-{e.status}" aria-hidden="true">⚠</span>{e.label}</li>
      {/each}
    </ul>

    <h4>Documents</h4>
    <ul class="legend-list">
      <li><span class="legend-unreachable"></span>{warningLegend.unreachable}</li>
    </ul>
  </div>
</details>
