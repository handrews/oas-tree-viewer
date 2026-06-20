<script lang="ts">
  import type { DocInput } from "../loader";
  import OadForm from "../ui/OadForm.svelte";
  import type { RenderOutcome } from "../ui/oadForm";
  import { runPipeline } from "../app/bootstrap";
  import { demos } from "../app/demos";
  import { session } from "../app/session.svelte";
  import { navigate } from "../app/router.svelte";
  import { viewPath } from "../app/viewUrl";

  // The Configure page: choose document sources (the existing form) or a pre-built demo,
  // then route to the Explore page. Online-URL and demo renders encode fully into the view
  // URL (bookmarkable); upload renders are resolved here and handed off in memory.
  async function onRender(inputs: DocInput[]): Promise<RenderOutcome> {
    if (inputs.every((i) => i.source === "url")) {
      const docs = inputs.flatMap((i) => (i.source === "url" ? [{ url: i.url, isEntry: i.isEntry }] : []));
      navigate(viewPath({ kind: "urls", docs }));
      return { ok: true };
    }
    // Anything with an uploaded file can't live in a URL, so resolve it here — keeping
    // per-row / OAD errors inline on the form — and hand the result to a bare /view.
    const result = await runPipeline(inputs);
    if (!result.ok) return { ok: false, rowErrors: result.rowErrors, oadError: result.oadError };
    session.result = { oad: result.oad, refs: result.refs };
    navigate("/view");
    return { ok: true };
  }

  function openDemo(id: string): void {
    navigate(viewPath({ kind: "demo", demoId: id }));
  }
</script>

<section id="input-panel" aria-label="OAD input">
  <OadForm {onRender} />

  <section class="demos" aria-label="Example documents">
    <h2>Or explore an example</h2>
    <ul class="demo-list">
      {#each demos as demo (demo.id)}
        <li class="demo-item">
          <button type="button" class="demo-open" onclick={() => openDemo(demo.id)}>
            {demo.label}
          </button>
          <p class="demo-desc">{demo.description}</p>
        </li>
      {/each}
    </ul>
  </section>
</section>
