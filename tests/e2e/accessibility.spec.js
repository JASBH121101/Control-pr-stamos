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


test("font size slider updates the page scale and persists the selected level", async ({ page }) => {
  await page.goto("/");
  const slider = page.getByRole("slider", { name: "Nivel de tamaño del texto" });
  await expect(slider).toBeVisible();
  await slider.fill("120");
  await expect(page.locator("#font-size-value")).toHaveText("120%");
  await expect(page.locator("html")).toHaveCSS("zoom", "1.2");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("control-prestamos-font-zoom"))).toBe("1.2");
});

test("login reports that email confirmation is required instead of a generic error", async ({ page }) => {
  await page.route(/\/auth\/v1\/token\?grant_type=password/, route => route.fulfill({
    status: 400,
    contentType: "application/json",
    body: JSON.stringify({ code: "email_not_confirmed", message: "Email not confirmed" })
  }));
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill("owner@example.com");
  await page.getByLabel("Contraseña").fill("ValidPassword123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.locator("#auth-error")).toContainText("Tu correo todavía no está confirmado");
});

test("sign-up shows Supabase's email rate-limit error in Spanish", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("control-prestamos-pending-owner-claim", "test-claim-token"));
  await page.route(/\/auth\/v1\/signup/, route => route.fulfill({
    status: 429,
    contentType: "application/json",
    body: JSON.stringify({ code: "over_email_send_rate_limit", message: "Email rate limit exceeded" })
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await page.getByLabel("Nombre para mostrar").fill("Propietario de prueba");
  await page.getByLabel("Correo electrónico").fill("owner@example.com");
  await page.getByLabel("Contraseña").fill("ValidPassword123!");
  await page.getByRole("button", { name: "Crear cuenta" }).last().click();
  await expect(page.locator("#auth-error")).toContainText("Supabase limitó temporalmente el envío de correos");
});
