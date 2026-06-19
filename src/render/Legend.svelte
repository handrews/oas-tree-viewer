<script lang="ts">
  // Collapsible legend explaining the diagram's colors (semantic object groups), marker
  // shapes (typed object / generic value / reference), connection-line styles, error-icon
  // colors, and the unreachable-document warning. All data comes from colors.ts so the legend
  // and the renderer can't drift.
  import {
    categoryClass,
    categoryLabel,
    legendGroups,
    shapeLegend,
    lineLegend,
    errorIconLegend,
    warningLegend,
  } from "./colors";
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
          <span class="legend-shape shape-{s.shape}">{s.shape === "asterisk" ? "✱" : ""}</span>
          {s.label}
        </li>
      {/each}
    </ul>

    <h4>Connection lines</h4>
    <ul class="legend-list">
      {#each lineLegend as l (l.style)}
        <li><span class="legend-line line-{l.style}"></span>{l.label}</li>
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
