import { test, expect } from "@playwright/test";
import { fixture, renderUploads } from "./helpers";

test.describe("rendering an OAD", () => {
  test("renders one tree per uploaded document, entry first", async ({ page }) => {
    await renderUploads(page, ["petstore-3.1.yaml", "shared-3.1.yaml"]);

    const docs = page.locator("svg.tree-canvas g.doc");
    await expect(docs).toHaveCount(2);
    // The entry document carries the ENTRY badge.
    await expect(page.locator(".entry-badge")).toHaveCount(1);
    // The detail panel shows the legend once a render has happened.
    await expect(page.locator("#detail-panel")).toContainText("Legend");
  });

  test("expand all / collapse all change the visible row count", async ({ page }) => {
    await renderUploads(page, ["petstore-3.1.yaml"]);
    const rows = page.locator("svg.tree-canvas g.row");

    await page.getByRole("button", { name: "Expand all" }).click();
    const expanded = await rows.count();
    await page.getByRole("button", { name: "Collapse all" }).click();
    const collapsed = await rows.count();

    expect(expanded).toBeGreaterThan(collapsed);
  });

  test("selecting a node populates the detail panel", async ({ page }) => {
    await renderUploads(page, ["petstore-3.1.yaml"]);

    await page.locator("svg.tree-canvas g.row").first().click();
    const detail = page.locator("#detail-panel .node-detail");
    await expect(detail).toContainText("Selected node");
    await expect(detail).toContainText("Pointer");
  });
});

test.describe("references", () => {
  test("show-all draws reference arcs and warning glyphs", async ({ page }) => {
    await renderUploads(page, ["refs-3.1.yaml", "refs-shared-3.1.yaml"]);

    await page.getByRole("button", { name: "Show all references" }).click();

    // Resolvable references become arcs; broken/external ones show a ⚠ glyph.
    await expect(page.locator("svg.tree-canvas .arcs path.ref-edge").first()).toBeVisible();
    await expect(page.locator("svg.tree-canvas .warnings text.warn-glyph").first()).toBeVisible();

    // The same problems are written out in the copy-pasteable issue drawer.
    const issues = page.locator("#issues");
    await expect(issues).toBeVisible();
    await expect(issues).toContainText("Unresolved references");
    await expect(issues.locator(".copy-report")).toBeVisible();
    await expect(issues.locator(".issue").first()).toBeVisible();
  });
});

test.describe("error handling", () => {
  test("a non-OpenAPI document is reported on its row", async ({ page }) => {
    await page.goto("/");
    await page.locator(".doc-row").first().locator("input.file").setInputFiles(fixture("not-openapi.json"));
    await page.getByRole("button", { name: "Render OAD" }).click();

    await expect(page.locator(".row-error")).toContainText(/neither an OpenAPI document nor/i);
    await expect(page.locator("#viewer")).toBeHidden();
  });

  test("an unparseable document is reported on its row", async ({ page }) => {
    await page.goto("/");
    await page.locator(".doc-row").first().locator("input.file").setInputFiles(fixture("invalid.yaml"));
    await page.getByRole("button", { name: "Render OAD" }).click();

    await expect(page.locator(".row-error")).toContainText(/Invalid YAML|Could not parse/i);
  });

  test("mixing OAS 3.1 and 3.2 is reported above the form", async ({ page }) => {
    await page.goto("/");
    await page.locator(".doc-row").first().locator("input.file").setInputFiles(fixture("petstore-3.1.yaml"));
    await page.getByRole("button", { name: "+ Add document" }).click();
    await page.locator(".doc-row").nth(1).locator("input.file").setInputFiles(fixture("tictactoe-3.2.yaml"));
    await page.getByRole("button", { name: "Render OAD" }).click();

    await expect(page.locator(".oad-error")).toContainText(/mixes OAS 3.1 and 3.2/i);
  });

  test("a Link with both operationRef and operationId is rejected on its row", async ({ page }) => {
    await page.goto("/");
    await page
      .locator(".doc-row")
      .first()
      .locator("input.file")
      .setInputFiles(fixture("operationid-both-targets.yaml"));
    await page.getByRole("button", { name: "Render OAD" }).click();

    await expect(page.locator(".row-error")).toContainText(/both operationRef and operationId/i);
    await expect(page.locator("#viewer")).toBeHidden();
  });

  test("two Operations sharing an operationId in one document is rejected", async ({ page }) => {
    await page.goto("/");
    await page
      .locator(".doc-row")
      .first()
      .locator("input.file")
      .setInputFiles(fixture("operationid-dup-same-doc.yaml"));
    await page.getByRole("button", { name: "Render OAD" }).click();

    await expect(page.locator(".oad-error")).toContainText(/Duplicate operationId "listThings"/i);
    await expect(page.locator("#viewer")).toBeHidden();
  });

  test("an operationId duplicated across two documents is rejected above the form", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .locator(".doc-row")
      .first()
      .locator("input.file")
      .setInputFiles(fixture("operationid-dup-cross-a.yaml"));
    await page.getByRole("button", { name: "+ Add document" }).click();
    await page
      .locator(".doc-row")
      .nth(1)
      .locator("input.file")
      .setInputFiles(fixture("operationid-dup-cross-b.yaml"));
    await page.getByRole("button", { name: "Render OAD" }).click();

    await expect(page.locator(".oad-error")).toContainText(/Duplicate operationId "sharedOp"/i);
    await expect(page.locator("#viewer")).toBeHidden();
  });
});

test.describe("demos, online URLs & bookmarking", () => {
  test("/ redirects to /configure and shows the form", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/configure$/);
    await expect(page.locator(".oad-form")).toBeVisible();
  });

  test("a demo loads, is bookmarkable, and Back returns to configure", async ({ page }) => {
    await page.goto("/configure");
    await page.getByRole("button", { name: "Broken & external references (3.1)" }).click();

    await expect(page).toHaveURL(/\/view\?demo=refs/);
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(2);
    const issues = page.locator("#issues");
    await expect(issues).toBeVisible();
    await expect(issues).toContainText("Unresolved references");
    await expect(issues.locator(".copy-report")).toBeVisible();

    // Reloading the bookmarked URL reproduces the same view (SPA fallback serves index.html).
    await page.reload();
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(2);

    // Back returns to the configure page.
    await page.goBack();
    await expect(page).toHaveURL(/\/configure/);
    await expect(page.locator(".oad-form")).toBeVisible();
  });

  test("the view page has a button to load a different OAD", async ({ page }) => {
    await page.goto("/view?demo=refs");
    await expect(page.locator("svg.tree-canvas g.doc").first()).toBeVisible();

    await page.getByRole("button", { name: "Load a different OAD" }).click();
    await expect(page).toHaveURL(/\/configure/);
    await expect(page.locator(".oad-form")).toBeVisible();
  });

  test("the $self demo resolves cleanly (no issues)", async ({ page }) => {
    await page.goto("/configure");
    await page.getByRole("button", { name: "Multi-document $self (3.2)" }).click();

    await expect(page).toHaveURL(/\/view\?demo=self/);
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(4);
    await expect(page.locator("#issues .issue")).toHaveCount(0);
  });

  test("an online document URL loads directly and is bookmarkable", async ({ page }) => {
    await page.goto("/view?doc=" + encodeURIComponent("/fixtures/petstore-3.1.yaml"));
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(1);
  });

  test("a reloaded upload view shows the empty state", async ({ page }) => {
    await page.goto("/configure");
    await page.locator(".doc-row").first().locator("input.file").setInputFiles(fixture("petstore-3.1.yaml"));
    await page.getByRole("button", { name: "Render OAD" }).click();
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(1);

    // The upload handoff lives only in memory; a full reload drops it -> empty state.
    await page.reload();
    await expect(page.locator(".view-empty")).toBeVisible();
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page).toHaveURL(/\/configure/);
  });
});

test.describe("component-name references", () => {
  test("distinguishes component-name (diamond) from URI (asterisk) markers", async ({ page }) => {
    await page.goto("/view?demo=component-refs");
    await page.getByRole("button", { name: "Expand all" }).click();

    // Component names resolve to a diamond; URI-references ($refs and the URI-valued mapping/
    // security) resolve to an asterisk.
    await expect(page.locator("svg .marker.diamond")).toHaveCount(6);
    await expect(page.locator("svg .marker.asterisk").first()).toBeVisible();
  });

  test("component-name arcs use the open arrowhead + double (offset) lines", async ({ page }) => {
    await page.goto("/view?demo=component-refs");
    await page.getByRole("button", { name: "Expand all" }).click();
    await page.getByRole("button", { name: "Show all references" }).click();

    // The arrowhead carrier supplies the open arrowhead.
    await expect(page.locator("svg .ref-edge.dbl-head").first()).toHaveAttribute(
      "marker-end",
      "url(#ref-arrow-open)",
    );
    // The double line is two visible offset strokes.
    await expect(page.locator("svg .ref-edge.dbl-line").first()).toBeVisible();
  });

  test("the uri-first config flips the ambiguous mapping from a component name to a URI", async ({ page }) => {
    await page.goto("/view?demo=component-refs&disc=uri-first");
    await page.getByRole("button", { name: "Expand all" }).click();
    // "dual" becomes a URI-reference, so one fewer diamond than the name-first default (6 -> 5).
    await expect(page.locator("svg .marker.diamond")).toHaveCount(5);
  });

  test("the entry-vs-local lookup changes resolution in a referenced document", async ({ page }) => {
    // Default (entry lookup): the referenced doc's names resolve in the entry; 2 issues.
    await page.goto("/view?demo=component-refs");
    await expect(page.locator("#issues .issue-count")).toHaveText("2");

    // Local lookup: the referenced doc's entry-only "special" mapping no longer resolves -> 3 issues.
    await page.goto("/view?demo=component-refs&lookup=local");
    await expect(page.locator("#issues .issue-count")).toHaveText("3");
  });

  test("the Resolution options on the configure page feed into the view URL", async ({ page }) => {
    await page.goto("/configure");
    await page.locator(".resolution-options > summary").click();
    await page.locator(".resolution-options select").first().selectOption("uri-first");
    await page.getByRole("button", { name: "Component-name references (3.2)" }).click();
    await expect(page).toHaveURL(/disc=uri-first/);
  });
});

test.describe("operation reference advisories", () => {
  test("flags operation references by habitat with advisory glyphs and tinted arcs", async ({
    page,
  }) => {
    await page.goto("/view?demo=operation-refs");
    await page.getByRole("button", { name: "Expand all" }).click();
    await page.getByRole("button", { name: "Show all references" }).click();

    // One ▲ advisory glyph per flagged source row: 5 operation targets + 1 Path Item overlap.
    await expect(page.locator("svg .advisory-glyph")).toHaveCount(6);
    // Operation-target arcs tint by severity (webhook/callback/ambiguous/no-path = 4 error,
    // fragile = 1 warning); the Path Item field-overlap arc stays untinted (glyph-only).
    await expect(page.locator("svg .ref-edge.diag-error")).toHaveCount(4);
    await expect(page.locator("svg .ref-edge.diag-warning")).toHaveCount(1);

    // Every reference resolves, so the drawer's six issues are all advisories.
    const issues = page.locator("#issues");
    await expect(issues).toBeVisible();
    await expect(issues.locator(".issue-count")).toHaveText("6");
    await expect(issues).toContainText("Reference advisories (6)");
    await expect(issues).toContainText("not directly callable");
    await expect(issues).toContainText("merge behavior is undefined");
  });
});

test.describe("operationId links", () => {
  test("resolves operationId Links as implicit connections, reusing operation advisories", async ({
    page,
  }) => {
    await page.goto("/view?demo=operationid");
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(3);
    await page.getByRole("button", { name: "Expand all" }).click();
    await page.getByRole("button", { name: "Show all references" }).click();

    // Each of the 9 operationId fields gets the implicit-connection diamond marker; the 4 $refs
    // (component Path Items + the shared-document link) get the URI-reference asterisk.
    await expect(page.locator("svg .marker.diamond")).toHaveCount(9);
    await expect(page.locator("svg .marker.asterisk")).toHaveCount(4);

    // The 8 resolved operationId Links draw a double-line (open-arrowhead) implicit arc — one
    // `dbl-head` per edge. Five of them carry operation-target advisories (4 error: webhook /
    // callback / ambiguous / no-path; 1 warning: fragile), tinting the arc and adding a ▲ glyph.
    await expect(page.locator("svg path.ref-edge.dbl-head")).toHaveCount(8);
    await expect(page.locator("svg path.ref-edge.dbl-head.diag-error")).toHaveCount(4);
    await expect(page.locator("svg path.ref-edge.dbl-head.diag-warning")).toHaveCount(1);
    await expect(page.locator("svg .advisory-glyph")).toHaveCount(5);
    // The one broken operationId (`missing`) shows a ⚠ glyph.
    await expect(page.locator("svg .warnings text.warn-glyph")).toHaveCount(1);

    // The drawer: 1 broken reference + 5 advisories + 1 unreachable document.
    const issues = page.locator("#issues");
    await expect(issues.locator(".issue-count")).toHaveText("7");
    await expect(issues).toContainText("Unresolved references (1)");
    await expect(issues).toContainText('no Operation declares operationId "noSuchOp"');
    await expect(issues).toContainText("Reference advisories (5)");
    await expect(issues).toContainText("not directly callable");
    await expect(issues).toContainText("Unreachable documents (1)");
  });
});

test.describe("$dynamicRef links", () => {
  test("draws a dynamic $dynamicRef as dotted tentative arcs; static cases stay solid", async ({
    page,
  }) => {
    await page.goto("/view?demo=dynamicref");
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(3);
    await page.getByRole("button", { name: "Expand all" }).click();
    await page.getByRole("button", { name: "Show all references" }).click();

    // Every reference field is a URI-reference asterisk (3 $dynamicRef + 6 $ref: three response
    // refs, two extension allOf refs, and the Case-B $ref); none are the implicit diamond.
    await expect(page.locator("svg .marker.asterisk")).toHaveCount(9);
    await expect(page.locator("svg .marker.diamond")).toHaveCount(0);

    // The one dynamic $dynamicRef (#item) fans out, dotted, to its two strict winners — StrictList
    // and LooseList. Its three other same-named $dynamicAnchors are hidden: the shadowed default,
    // Unrelated (can't reach the ref), and the remote one (unreachable). The seven static resolves
    // — three response $refs, two extension allOf $refs, the Case-B $ref→$dynamicAnchor, and the
    // Case-A $dynamicRef→$anchor — stay solid.
    await expect(page.locator("svg path.ref-edge.dotted")).toHaveCount(2);
    await expect(page.locator("svg path.ref-edge.status-resolved:not(.dotted)")).toHaveCount(7);
    // The broken $dynamicRef (#missing) shows a ⚠ glyph, not an arc.
    await expect(page.locator("svg .warnings text.warn-glyph")).toHaveCount(1);

    // The drawer: 1 broken reference + 1 unreachable document (the dynamic fan-out resolves).
    const issues = page.locator("#issues");
    await expect(issues.locator(".issue-count")).toHaveText("2");
    await expect(issues).toContainText("Unresolved references (1)");
    await expect(issues).toContainText("#missing");
    await expect(issues).toContainText("Unreachable documents (1)");
  });
});

test.describe("dialect resolution warnings", () => {
  test("flags a Schema Object on an unsupported dialect with a ⚠ and a detail note", async ({
    page,
  }) => {
    await page.goto("/view?demo=dialects");
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(1);
    await page.getByRole("button", { name: "Expand all" }).click();

    // Exactly one dialect warning glyph — the draft-03 $schema row (2020-12, 2019-09, draft-04/06/07
    // all resolve now, so only the too-old draft-03 is flagged).
    await expect(page.locator("svg .warnings text.warn-glyph.status-dialect")).toHaveCount(1);

    // Selecting that $schema row shows the resolution note; the structure still rendered.
    await page.locator("svg.tree-canvas g.row", { hasText: "draft-03/schema" }).first().click();
    await expect(page.locator("#detail-panel .node-detail")).toContainText("isn't fully supported");
  });
});

test.describe("$recursiveRef links (2019-09)", () => {
  test("fans an engaged $recursiveRef out to dotted winners; a static one stays solid", async ({
    page,
  }) => {
    await page.goto("/view?demo=recursiveref");
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(1);
    await page.getByRole("button", { name: "Expand all" }).click();
    await page.getByRole("button", { name: "Show all references" }).click();

    // Seven reference fields, all asterisks: three response $refs, two extension allOf $refs, and the
    // two $recursiveRefs. None are the implicit diamond, and 2019-09 needs no dialect ⚠.
    await expect(page.locator("svg .marker.asterisk")).toHaveCount(7);
    await expect(page.locator("svg .marker.diamond")).toHaveCount(0);
    await expect(page.locator("svg .warnings text.warn-glyph.status-dialect")).toHaveCount(0);

    // GenericTree's $recursiveRef fans out, dotted, to its two strict winners (StrictTree, LooseTree);
    // PlainTree's $recursiveRef is a solid static self-reference. The six other resolves stay solid.
    await expect(page.locator("svg path.ref-edge.dotted")).toHaveCount(2);
    await expect(page.locator("svg path.ref-edge.status-resolved:not(.dotted)")).toHaveCount(6);

    // Everything resolves and every document is reachable — a clean drawer.
    await expect(page.locator("#issues .issue-count")).toHaveText("0");
  });
});

test.describe("standalone JSON Schema document", () => {
  test("renders a Schema-Object root, a dialect header, and resolves its internal refs", async ({
    page,
  }) => {
    await page.goto("/view?demo=jsonschema");
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(1);

    // The root reads "Schema Object", and the header shows the JSON Schema dialect, not an OAS version.
    await expect(page.locator("svg.tree-canvas g.row", { hasText: "Schema Object" }).first()).toBeVisible();
    await expect(page.locator("svg .doc-sub").first()).toContainText("JSON Schema 2020-12");

    await page.getByRole("button", { name: "Expand all" }).click();
    await page.getByRole("button", { name: "Show all references" }).click();

    // Three internal $ref fields (the recursive #, the $defs pointer, and the $anchor name), all
    // URI-reference asterisks — none implicit diamonds, and 2020-12 needs no dialect ⚠.
    await expect(page.locator("svg .marker.asterisk")).toHaveCount(3);
    await expect(page.locator("svg .marker.diamond")).toHaveCount(0);
    await expect(page.locator("svg .warnings text.warn-glyph.status-dialect")).toHaveCount(0);

    // All three resolve to solid arcs, and the drawer is clean.
    await expect(page.locator("svg path.ref-edge.status-resolved:not(.dotted)")).toHaveCount(3);
    await expect(page.locator("svg path.ref-edge.dotted")).toHaveCount(0);
    await expect(page.locator("#issues .issue-count")).toHaveText("0");
  });
});

test.describe("document fragments", () => {
  test("types a Path Item fragment from a reference and labels its header", async ({ page }) => {
    await page.goto("/view?demo=fragment&fragments=root");
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(2);

    // The fragment's header reads "Fragment · <inferred type>", and its root row is the inferred type.
    await expect(
      page.locator("svg .doc-sub", { hasText: "Fragment · Path Item Object" }),
    ).toHaveCount(1);
    await expect(
      page.locator("svg.tree-canvas g.row", { hasText: "Path Item Object" }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Expand all" }).click();
    await page.getByRole("button", { name: "Show all references" }).click();

    // Every reference resolves (the entry's Path Item $ref + the fragment's two schema $refs + the
    // entry's own Pet $ref), all solid, and the drawer is clean.
    await expect(page.locator("svg path.ref-edge.status-resolved")).toHaveCount(4);
    await expect(page.locator("svg .warnings text.warn-glyph")).toHaveCount(0);
    await expect(page.locator("#issues .issue-count")).toHaveText("0");
  });

  test("the fragment demo opens with fragments enabled in the URL", async ({ page }) => {
    await page.goto("/configure");
    await page.getByRole("button", { name: "Document fragment — Path Item (3.1)" }).click();
    await expect(page).toHaveURL(/\/view\?demo=fragment.*fragments=root/);
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(2);
  });

  test("types interior nodes of a Components-Object fragment and labels it partially typed", async ({
    page,
  }) => {
    await page.goto("/view?demo=fragment-interior&fragments=any");
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(2);

    // No reference targets the Components-Object root, so its header reads "partially typed"; the
    // referenced interior nodes type as a Schema Object (#/schemas/*) and a Response Object
    // (#/responses/PetList).
    await expect(
      page.locator("svg .doc-sub", { hasText: "Fragment · partially typed" }),
    ).toHaveCount(1);

    await page.getByRole("button", { name: "Expand all" }).click();
    await page.getByRole("button", { name: "Show all references" }).click();
    await expect(
      page.locator("svg.tree-canvas g.row", { hasText: "Schema Object" }).first(),
    ).toBeVisible();
    await expect(
      page.locator("svg.tree-canvas g.row", { hasText: "Response Object" }).first(),
    ).toBeVisible();

    // Every reference resolves (entry → #/responses/PetList, #/schemas/Pet, #/schemas/Error, plus the
    // two internal refs Pet → Error and PetList → Pet), all solid, with a clean drawer.
    await expect(page.locator("svg path.ref-edge.status-resolved")).toHaveCount(5);
    await expect(page.locator("svg .warnings text.warn-glyph")).toHaveCount(0);
    await expect(page.locator("#issues .issue-count")).toHaveText("0");
  });
});

test.describe("numbered-draft resolution advisories", () => {
  test("resolves identifier-fragment anchors and flags ignored siblings / a wrong id fragment", async ({
    page,
  }) => {
    await page.goto("/view?demo=numbered-drafts");
    await expect(page.locator("svg.tree-canvas g.doc")).toHaveCount(1);
    await page.getByRole("button", { name: "Expand all" }).click();

    // Three advisory glyphs: Catalog's ignored-sibling $ref and mis-pointed $id (draft-07), plus
    // Draft04's mis-pointed `id` (draft-04). The 2020-12/draft-07/draft-04 $schema rows are all
    // supported, so they carry no dialect ⚠.
    await expect(page.locator("svg .warnings text.warn-glyph.status-dialect")).toHaveCount(3);

    // The issues drawer aggregates all three advisories, plus the one $ref that leans on a draft-07
    // `$anchor` (which doesn't exist) and so breaks.
    const issues = page.locator("#issues");
    await expect(issues).toContainText("Reference-resolution advisories (3)");
    await expect(issues).toContainText("Unresolved references (1)");

    // Selecting the ignored-sibling $ref row shows its detail note.
    await page.locator("svg.tree-canvas g.row", { hasText: "#/properties/thing" }).first().click();
    await expect(page.locator("#detail-panel .node-detail")).toContainText(
      "keywords beside $ref are ignored",
    );
  });
});
