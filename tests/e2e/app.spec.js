import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#auth-panel")).toBeVisible();
});

test("shows login and an accessible create-account option", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Inicia sesión" })).toBeVisible();
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear cuenta" })).toBeVisible();
  await expect(page.locator(".record-card")).toHaveCount(0);
});

test("create-account option reveals the name field and can return to login", async ({ page }) => {
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Crear cuenta" })).toBeVisible();
  await expect(page.getByLabel("Nombre para mostrar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ya tengo cuenta" })).toBeVisible();
  await page.getByRole("button", { name: "Ya tengo cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Inicia sesión" })).toBeVisible();
  await expect(page.getByLabel("Nombre para mostrar")).toBeHidden();
});

test("font-size controls enlarge, reset and persist the user preference", async ({ page }) => {
  await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe("1");
  await page.getByRole("button", { name: "Aumentar tamaño de texto" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe("1.1");
  await page.reload();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe("1.1");
  await page.getByRole("button", { name: "Restablecer tamaño de texto" }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe("1");
});

test("financial input uses C$ format and browser autocomplete is disabled for search", async ({ page }) => {
  await expect(page.locator("#amount")).toHaveAttribute("placeholder", "C$ 0.00");
  await expect(page.locator("#amount")).toHaveAttribute("autocomplete", "off");
  await expect(page.locator("#search")).toHaveAttribute("autocomplete", "off");
});
