import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("login and create-account screens have no critical or serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Inicia sesión" })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();
  const relevant = results.violations.filter(v => ["critical","serious"].includes(v.impact));
  expect(relevant, JSON.stringify(relevant.map(({id,impact,description,nodes})=>({id,impact,description,count:nodes.length})),null,2)).toEqual([]);
});

test("authentication fields are properly labeled and sign-up reveals the display name", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByLabel("Nombre para mostrar")).toBeVisible();
});



test("password visibility toggle preserves the value and exposes its state accessibly", async ({ page }) => {
  await page.goto("/");
  const password = page.locator("#auth-password");
  const toggle = page.getByRole("button", { name: "Mostrar contraseña" });

  await password.fill("PruebaSegura123!");
  await expect(password).toHaveAttribute("type", "password");
  await toggle.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("PruebaSegura123!");
  await expect(page.getByRole("button", { name: "Ocultar contraseña" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Ocultar contraseña" }).click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveValue("PruebaSegura123!");
  await expect(page.getByRole("button", { name: "Mostrar contraseña" })).toHaveAttribute("aria-pressed", "false");
});
