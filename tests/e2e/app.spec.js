import { test, expect } from "@playwright/test";

test("operator interface has no email/password fields and offers a PIN gate", async ({ page }) => {
  await page.goto("/operador.html");
  await expect(page.locator("#pairing-panel")).toBeVisible();
  await expect(page.locator("#pairing-title")).toBeVisible();
  await expect(page.locator("#auth-email")).toHaveCount(0);
  await expect(page.locator("#auth-password")).toHaveCount(0);
  await expect(page.locator("#pair-setup-form")).toHaveCount(1);
  await expect(page.locator("#pin-unlock-form")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /A\+ Aumentar tamaño de texto/ })).toBeVisible();
  await expect(page.locator("#lock-operator")).toBeAttached();
});

test("operator PIN forms enforce a 4-to-6 digit pattern", async ({ page }) => {
  await page.goto("/operador.html");
  await expect(page.locator("#new-pin")).toHaveAttribute("pattern", "[0-9]{4,6}");
  await expect(page.locator("#confirm-pin")).toHaveAttribute("pattern", "[0-9]{4,6}");
  await expect(page.locator("#operator-pin")).toHaveAttribute("pattern", "[0-9]{4,6}");
  await expect(page.locator("#new-pin")).toHaveAttribute("maxlength", "6");
});

test("owner interface exposes device pairing and revocation controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#device-admin-panel")).toBeAttached();
  await expect(page.locator("#create-operator-invite")).toBeAttached();
  await expect(page.locator("#operator-device-list")).toBeAttached();
});

test("operator money is a currency-formatted text field", async ({ page }) => {
  await page.goto("/operador.html");
  await expect(page.locator("#amount")).toHaveAttribute("type", "text");
  await expect(page.locator("#amount")).toHaveAttribute("placeholder", "C$ 0.00");
  await expect(page.locator("#amount")).toHaveAttribute("autocomplete", "off");
});
