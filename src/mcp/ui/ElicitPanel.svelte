<script lang="ts">
  // Renders one `elicitation/create` request as a form: `message` plus one control per property in
  // `requestedSchema` — string and string-enum only, since that's all analyze-document's two
  // elicitations (fragment consent, ambiguous entry) ever ask. Declining or cancelling is as
  // legitimate an outcome as accepting, so all three are ordinary buttons rather than a single submit
  // with a separate escape hatch.

  import type { ElicitFormSchema } from "../hosts/browser";

  type ElicitProp = ElicitFormSchema["properties"][string];

  let {
    message,
    requestedSchema,
    onRespond,
  }: {
    message: string;
    requestedSchema: ElicitFormSchema;
    onRespond: (result: {
      action: "accept" | "decline" | "cancel";
      content?: Record<string, string>;
    }) => void;
  } = $props();

  function properties(): [string, ElicitProp][] {
    return Object.entries(requestedSchema.properties);
  }

  function isRequired(key: string): boolean {
    return requestedSchema.required?.includes(key) ?? false;
  }

  function initialValues(): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [key, prop] of properties()) values[key] = prop.enum?.[0] ?? "";
    return values;
  }

  let values = $state<Record<string, string>>(initialValues());
  let panel = $state<HTMLFormElement | null>(null);

  // The panel interrupts an in-flight tool call and appears with no user gesture of its own, so
  // keyboard/screen-reader focus is moved to its first control rather than left wherever the "Call"
  // button was — the section's own heading (McpPage) gives it a name for anyone tabbing back.
  $effect(() => {
    panel?.querySelector<HTMLElement>("input, select")?.focus();
  });

  function handleSubmit(e: SubmitEvent): void {
    e.preventDefault();
    onRespond({ action: "accept", content: $state.snapshot(values) });
  }
</script>

<form class="elicit-panel" bind:this={panel} onsubmit={handleSubmit}>
  <p class="elicit-message">{message}</p>
  {#each properties() as [key, prop] (key)}
    <label class="elicit-label">
      <span>{prop.title ?? key}</span>
      {#if prop.enum}
        <select
          required={isRequired(key)}
          value={values[key]}
          onchange={(e) => (values[key] = (e.target as HTMLSelectElement).value)}
        >
          {#each prop.enum as opt (opt)}
            <option value={opt}>{opt}</option>
          {/each}
        </select>
      {:else}
        <input
          type="text"
          required={isRequired(key)}
          value={values[key]}
          oninput={(e) => (values[key] = (e.target as HTMLInputElement).value)}
        />
      {/if}
    </label>
  {/each}
  <div class="elicit-actions">
    <button type="submit" class="elicit-submit">Submit</button>
    <button type="button" class="elicit-decline" onclick={() => onRespond({ action: "decline" })}>
      Decline
    </button>
    <button type="button" class="elicit-cancel" onclick={() => onRespond({ action: "cancel" })}>
      Cancel
    </button>
  </div>
</form>
