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
    diagnosticLegend,
    warningLegend,
  } from "./colors";

  const markerGlyph = (shape: string): string => (shape === "diamond" ? "◆" : "✱");
</script>

<details class="legend" open>
  <summary><h2>Legend</h2></summary>
  <div class="legend-body">
    <h3>Object groups</h3>
    <ul class="legend-list">
      {#each legendGroups as cat (cat)}
        <li>
          <span class="swatch shape-circle {categoryClass(cat)}"></span>{categoryLabel[cat]}
        </li>
      {/each}
    </ul>

    <h3>Node shapes</h3>
    <ul class="legend-list">
      {#each shapeLegend as s (s.shape)}
        <li>
          <span class="legend-shape shape-{s.shape}"></span>
          {s.label}
        </li>
      {/each}
    </ul>

    <h3>References</h3>
    <ul class="legend-list">
      {#each referenceLegend as r (r.kind)}
        <li>
          <span class="legend-shape shape-{r.marker}">{markerGlyph(r.marker)}</span>
          <span class="ref-sample">
            <span class="legend-line line-{r.line}" class:line-dotted={r.dash === "dotted"}></span>
            <span class="ref-arrow-sample" aria-hidden="true"
              >{r.arrowhead === "open" ? "▷" : "▶"}</span
            >
          </span>
          {r.label}
        </li>
      {/each}
    </ul>

    <h3>Connection lines</h3>
    <ul class="legend-list">
      {#each lineLegend as l (l.variant)}
        <li>
          <span class="legend-line line-dashed" class:line-error={l.variant === "type-mismatch"}
          ></span>
          {l.label}
        </li>
      {/each}
    </ul>

    <h3>Error icons</h3>
    <ul class="legend-list">
      {#each errorIconLegend as e (e.status)}
        <li><span class="legend-warn status-{e.status}" aria-hidden="true">⚠</span>{e.label}</li>
      {/each}
    </ul>

    <h3>Reference advisories</h3>
    <ul class="legend-list">
      {#each diagnosticLegend as a (a.severity)}
        <li>
          <span class="legend-advisory {a.colorClass}" aria-hidden="true">{a.glyph}</span>{a.label}
        </li>
      {/each}
    </ul>

    <h3>Documents</h3>
    <ul class="legend-list">
      <li><span class="legend-unreachable"></span>{warningLegend.unreachable}</li>
    </ul>
  </div>
</details>
