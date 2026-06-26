import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import IssueReport from "../../src/render/IssueReport.svelte";
import type { IssueReport as IssueReportData } from "../../src/render/issues";

const report: IssueReportData = {
  entry: "openapi.yaml",
  docLabels: { a: "openapi.yaml", b: "extra.yaml" },
  diagnostics: [
    {
      code: "ref-broken",
      severity: "error",
      source: "reference",
      message: "target not found (the fragment names nothing)",
      location: { docId: "a", pointer: "/paths/p" },
      ref: { kind: "$ref", refString: "#/missing" },
    },
    {
      code: "operation-target-webhook",
      severity: "error",
      source: "reference",
      message: "the target Operation is a webhook, which is not directly callable",
      location: { docId: "a", pointer: "/paths/p/get/responses/200/links/x" },
      ref: { kind: "operationRef", refString: "#/webhooks/hook/get" },
    },
    {
      code: "ignored-ref-siblings",
      severity: "warning",
      source: "reference",
      message: "In draft-06/07, keywords beside $ref are ignored: type.",
      location: { docId: "a", pointer: "/components/schemas/X/$ref" },
    },
    {
      code: "document-unreachable",
      severity: "warning",
      source: "reference",
      message: "not reachable from the entry document",
      location: { docId: "b", pointer: "" },
    },
  ],
  total: 4,
};

test("renders nothing when there is no report", () => {
  render(IssueReport, { report: null });
  expect(document.querySelector("#issues")).toBeNull();
});

test("lists reference and document issues", async () => {
  const screen = render(IssueReport, { report });
  await expect.element(screen.getByText("Unresolved references (1)")).toBeVisible();
  await expect.element(screen.getByText("Reference advisories (1)")).toBeVisible();
  await expect.element(screen.getByText("Reference-resolution advisories (1)")).toBeVisible();
  await expect.element(screen.getByText("Unreachable documents (1)")).toBeVisible();
  await expect.element(screen.getByText("#/missing")).toBeVisible();
  await expect.element(screen.getByText("#/webhooks/hook/get")).toBeVisible();
  await expect.element(screen.getByText("#/components/schemas/X/$ref")).toBeVisible();
  await expect.element(screen.getByText("extra.yaml")).toBeVisible();
  expect(document.querySelector("#issues")).not.toBeNull();
});

test("Copy report writes the formatted text to the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  render(IssueReport, { report });
  (document.querySelector(".copy-report") as HTMLButtonElement).click();

  await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  expect(writeText.mock.calls[0]![0]).toContain("Unresolved references (1):");
});
