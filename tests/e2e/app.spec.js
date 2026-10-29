import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("loads the simple mode and its key actions", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "¿Qué vamos a hacer hoy?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Registrar préstamo/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Registrar abono/ })).toBeVisible();
  await expect(page.locator(".record-main h3", { hasText: "María López" })).toBeVisible();
});

test("switches to owner mode and shows financial totals", async ({ page }) => {
  await page.getByRole("button", { name: "Propietario" }).click();
  await expect(page.getByRole("heading", { name: "Resumen de tu dinero" })).toBeVisible();
  await expect(page.getByText("Capital entregado")).toBeVisible();
  await expect(page.getByText("Abonos recibidos")).toBeVisible();
  await expect(page.getByRole("button", { name: "Propietario" })).toHaveAttribute("aria-pressed", "true");
});

test("registers a loan and updates the list", async ({ page }) => {
  await page.getByRole("button", { name: /Registrar préstamo/ }).click();
  await page.getByLabel("Nombre del cliente").fill("Prueba de cliente");
  await page.getByLabel("Monto en córdobas").fill("300");
  await page.getByRole("button", { name: "Guardar registro" }).click();
  await expect(page.locator(".record-main h3", { hasText: "Prueba de cliente" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Préstamo registrado");
});

test("rejects a payment above the outstanding balance", async ({ page }) => {
  await page.getByRole("button", { name: /＋ Abono/ }).first().click();
  await page.getByLabel("Monto en córdobas").fill("999999");
  await page.getByRole("button", { name: "Guardar registro" }).click();
  await expect(page.getByRole("alert")).toContainText("superar el saldo pendiente");
});

test("search filters pending loans by client", async ({ page }) => {
  await page.getByRole("searchbox", { name: "Buscar cliente" }).fill("Carlos");
  await expect(page.locator(".record-main h3", { hasText: "Carlos Ruiz" })).toBeVisible();
  await expect(page.locator(".record-main h3", { hasText: "María López" })).toHaveCount(0);
});

test("shows fixed simple interest and total before saving a loan", async ({ page }) => {
  await page.getByRole("button", { name: /Registrar préstamo/ }).click();
  await page.getByLabel("Nombre del cliente").fill("Interés prueba");
  await page.getByLabel("Monto en córdobas").fill("5000");
  await page.getByLabel("Plazo (meses)").fill("3");
  await expect(page.locator("#terms-preview")).toContainText("C$ 2,250.00");
  await expect(page.locator("#terms-preview")).toContainText("C$ 7,250.00");
  await page.getByRole("button", { name: "Guardar registro" }).click();
  await expect(page.locator(".record-main", { hasText: "Interés prueba" })).toContainText("C$ 7,250.00");
});

test("repeat loan keeps customer prefilled and creates a separate loan", async ({ page }) => {
  await page.locator(".record-card").filter({ hasText: "María López" }).getByRole("button", { name: /Prestar de nuevo/ }).click();
  await expect(page.getByLabel("Nombre del cliente")).toHaveValue("María López");
  await expect(page.getByLabel("Nombre del cliente")).toHaveAttribute("readonly", "");
  await page.getByLabel("Monto en córdobas").fill("100");
  await page.getByLabel("Plazo (meses)").fill("2");
  await page.getByRole("button", { name: "Guardar registro" }).click();
  await expect(page.locator(".record-card").filter({ hasText: "María López" })).toHaveCount(2);
});
