import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import IssueReport from "../../src/render/IssueReport.svelte";
import type { IssueReport as IssueReportData } from "../../src/render/issues";

const report: IssueReportData = {
  entry: "openapi.yaml",
  refIssues: [
    {
      severity: "error",
      status: "broken",
      sourceDoc: "openapi.yaml",
      sourcePointer: "#/paths/p",
      refString: "#/missing",
      detail: "target not found (the fragment names nothing)",
    },
  ],
  docIssues: [{ severity: "warning", doc: "extra.yaml", detail: "not reachable from the entry document" }],
  total: 2,
};

test("renders nothing when there is no report", () => {
  render(IssueReport, { report: null });
  expect(document.querySelector("#issues")).toBeNull();
});

test("lists reference and document issues", async () => {
  const screen = render(IssueReport, { report });
  await expect.element(screen.getByText("Unresolved references (1)")).toBeVisible();
  await expect.element(screen.getByText("Unreachable documents (1)")).toBeVisible();
  await expect.element(screen.getByText("#/missing")).toBeVisible();
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
