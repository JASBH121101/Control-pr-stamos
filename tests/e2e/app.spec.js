import { test, expect } from "@playwright/test";

test("operator interface has no email/password fields and offers a PIN gate", async ({ page }) => {
  await page.goto("/operador.html");
  await expect(page.locator("#pairing-panel")).toBeVisible();
  await expect(page.locator("#pairing-title")).toBeVisible();
  await expect(page.locator("#auth-email")).toHaveCount(0);
  await expect(page.locator("#auth-password")).toHaveCount(0);
  await expect(page.locator("#pair-setup-form")).toHaveCount(1);
  await expect(page.locator("#pin-unlock-form")).toHaveCount(1);
  await expect(page.getByRole("slider", { name: "Nivel de tamaño del texto" })).toBeVisible();
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
  await expect(page.locator("#client-phone")).toHaveCount(1);
  await expect(page.locator("#loan-date")).toHaveAttribute("type", "date");
  await expect(page.locator("#payment-date")).toHaveAttribute("type", "date");
  await expect(page.locator("#entry-panel")).toBeHidden();
  for (const id of ["#client-name", "#client-phone", "#amount", "#entry-note"]) {
    await expect(page.locator(id)).toHaveJSProperty("placeholder", "");
  }
  await expect(page.locator("#terms-preview")).toBeHidden();
});

test("operator forms include the loan date, payment date and optional phone", async ({ page }) => {
  await page.goto("/operador.html");
  await expect(page.locator("#client-phone")).toHaveCount(1);
  await expect(page.locator("#loan-date")).toHaveAttribute("type", "date");
  await expect(page.locator("#payment-date")).toHaveAttribute("type", "date");
  await expect(page.locator("#terms-preview")).toBeAttached();
  await expect(page.locator("#entry-panel")).toBeHidden();
  for (const id of ["#client-name", "#client-phone", "#amount", "#entry-note"]) {
    await expect(page.locator(id)).toHaveJSProperty("placeholder", "");
  }
  await expect(page.locator("#terms-preview")).toBeHidden();
});

test("operator money is a currency-formatted text field", async ({ page }) => {
  await page.goto("/operador.html");
  await expect(page.locator("#amount")).toHaveAttribute("type", "text");
  await expect(page.locator("#amount")).toHaveJSProperty("placeholder", "");
  await expect(page.locator("#amount")).toHaveAttribute("autocomplete", "off");
});

test("owner dashboard stays clean until an action is chosen and can rename a trusted device", async ({ page }) => {
  await page.route("https://esm.sh/@supabase/supabase-js@2.57.0", route => route.fulfill({
    status: 200,
    contentType: "text/javascript; charset=utf-8",
    headers: { "access-control-allow-origin": "*" },
    body: `
      export function createClient() {
        const user = { id: "owner-test-id", email: "owner@example.com" };
        const profile = { id: user.id, role: "owner", display_name: "Owner Test" };
        const device = { id: "device-1", device_name: "Celular de papá", is_active: true, paired_at: "2026-10-29T12:00:00Z", last_seen_at: "2026-10-29T12:10:00Z" };
        return {
          auth: {
            getSession: async () => ({ data: { session: null }, error: null }),
            signInWithPassword: async () => ({ data: { user }, error: null }),
            signOut: async () => ({ error: null })
          },
          from(table) {
            let updates = null;
            const query = {
              select() { return query; },
              eq() { return query; },
              order() {
                return Promise.resolve({ data: table === "operator_devices" ? [device] : [], error: null });
              },
              update(values) { updates = values; return query; },
              maybeSingle() {
                if (table === "profiles") return Promise.resolve({ data: profile, error: null });
                if (table === "operator_devices" && updates) {
                  Object.assign(device, updates);
                  window.__renamedTrustedDevice = device.device_name;
                  return Promise.resolve({ data: { id: device.id, device_name: device.device_name }, error: null });
                }
                return Promise.resolve({ data: null, error: null });
              }
            };
            return query;
          }
        };
      }
    `
  }));

  await page.goto("/");
  await page.locator("#auth-email").fill("owner@example.com");
  await page.locator("#auth-password").fill("password123");
  await page.locator("#auth-form button[type=submit]").click();

  await expect(page.locator("#connection-status")).toContainText("Conectado y sincronizado");
  await expect(page.locator("#entry-panel")).toBeHidden();
  for (const id of ["#client-name", "#client-phone", "#amount", "#entry-note"]) {
    await expect(page.locator(id)).toHaveJSProperty("placeholder", "");
  }
  await expect(page.locator("#terms-preview")).toBeHidden();
  await expect(page.locator("#show-loan-form")).toBeVisible();
  await expect(page.locator("#loan-records-panel")).toBeVisible();
  await expect(page.locator("#device-admin-panel")).toBeVisible();
  await expect(page.locator("#operator-device-list")).toContainText("Celular de papá");

  await page.locator("#show-loan-form").click();
  await expect(page.locator("#entry-panel")).toBeVisible();
  await page.locator("#close-form").click();
  await expect(page.locator("#entry-panel")).toBeHidden();

  await page.locator('[data-rename-device="device-1"]').click();
  const renameForm = page.locator('[data-rename-form="device-1"]');
  await expect(renameForm).toBeVisible();
  await renameForm.locator('input[name="device_name"]').fill("Celular principal");
  await renameForm.locator('button[type="submit"]').click();
  await expect(page.locator("#operator-device-list")).toContainText("Celular principal");
  await expect(page.locator("#toast")).toContainText("Nombre del dispositivo actualizado");
  await expect.poll(() => page.evaluate(() => window.__renamedTrustedDevice)).toBe("Celular principal");
});
