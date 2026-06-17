import path from "node:path";
import { expect, type Page } from "@playwright/test";

/** Absolute path to a bundled fixture OAD (served by the dev server too). */
export function fixture(name: string): string {
  return path.resolve("public/fixtures", name);
}

/**
 * Upload one or more fixture files as documents (first = entry) and render.
 * Leaves the viewer shown.
 */
export async function renderUploads(page: Page, names: string[]): Promise<void> {
  await page.goto("/");
  for (let i = 0; i < names.length; i++) {
    if (i > 0) await page.getByRole("button", { name: "+ Add document" }).click();
    await page.locator(".doc-row").nth(i).locator("input.file").setInputFiles(fixture(names[i]!));
  }
  await page.getByRole("button", { name: "Render OAD" }).click();
  await expect(page.locator("#viewer")).toBeVisible();
}
