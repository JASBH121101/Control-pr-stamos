import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("has no critical or serious axe accessibility violations in simple mode", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const relevant = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
  expect(relevant, JSON.stringify(relevant.map(({ id, impact, description, nodes }) => ({ id, impact, description, count: nodes.length })), null, 2)).toEqual([]);
});

test("form fields have accessible labels", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Registrar préstamo/ }).click();
  await expect(page.getByLabel("Nombre del cliente")).toBeVisible();
  await expect(page.getByLabel("Monto en córdobas")).toBeVisible();
});
