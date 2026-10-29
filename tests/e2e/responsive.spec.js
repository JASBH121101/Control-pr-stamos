import { test, expect } from "@playwright/test";

for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) {
  test(`layout fits viewport at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.getByRole("button", { name: "Modo sencillo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Propietario" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Préstamos pendientes" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`responsive-${width}.png`), fullPage: true });
  });
}
