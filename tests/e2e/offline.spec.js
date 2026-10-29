import { test, expect } from "@playwright/test";

test("operator PWA shell remains available after first online visit", async ({ page, context }) => {
  await page.goto("/operador.html");
  await expect(page.locator(".brand")).toBeVisible();
  const setup = await page.evaluate(async () => {
    const response = await fetch("./operator.webmanifest");
    const manifest = await response.json();
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
    return {
      manifestStart: manifest.start_url,
      hasActiveWorker: Boolean(registration.active),
      controlled: Boolean(navigator.serviceWorker.controller)
    };
  });
  expect(setup.manifestStart).toBe("./operador.html");
  expect(setup.hasActiveWorker).toBeTruthy();
  expect(setup.controlled).toBeTruthy();

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".brand")).toBeVisible();
  await expect(page.locator("#pairing-panel")).toBeVisible();
});

test("operator can create loans and payments offline and queue them durably", async ({ page, context }) => {
  await page.goto("/operador.html");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
    const store = await import("./src/offline-store.js");
    const ownerId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const customerId = crypto.randomUUID();
    const loanId = crypto.randomUUID();
    const now = new Date().toISOString();
    await store.createVault("4826", {
      ownerId,
      userId,
      customers: [{ id: customerId, owner_id: ownerId, full_name: "Cliente de prueba", created_at: now, updated_at: now }],
      loans: [{
        id: loanId,
        owner_id: ownerId,
        customer_id: customerId,
        principal_cents: 10000,
        term_months: 1,
        monthly_rate: 0.15,
        interest_cents: 1500,
        total_due_cents: 11500,
        status: "active",
        note: null,
        created_at: now,
        updated_at: now,
        customers: { full_name: "Cliente de prueba" },
        payments: [],
        paid_cents: 0
      }],
      queue: [],
      lastSyncAt: now
    });
    store.lockVault();
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#pin-unlock-form")).toBeVisible();
  await page.locator("#operator-pin").fill("4826");
  await page.locator("#unlock-submit").click();
  await expect(page.locator(".welcome")).toBeVisible();
  await expect(page.locator("#record-list")).toContainText("Cliente de prueba");
  const localDate = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  });

  await page.locator("[data-pay]").first().click();
  await page.locator("#payment-date").fill(localDate);
  await page.locator("#amount").fill("5.00");
  await page.locator("#entry-note").fill("Abono sin conexión");
  await page.locator("#entry-form button[type=submit]").click();
  await expect(page.locator("#offline-status")).toContainText("pendiente de sincronización");

  await page.locator("#show-loan-form").click();
  await page.locator("#client-name").fill("Nuevo Cliente Offline");
  await page.locator("#loan-date").fill(localDate);
  await page.locator("#amount").fill("100.00");
  await page.locator("#months").fill("2");
  await page.locator("#entry-note").fill("Préstamo sin conexión");
  await page.locator("#entry-form button[type=submit]").click();
  await expect(page.locator("#record-list")).toContainText("Nuevo Cliente Offline");

  const stored = await page.evaluate(async () => {
    const store = await import("./src/offline-store.js");
    const vault = store.getVault();
    const raw = await new Promise((resolve, reject) => {
      const request = indexedDB.open("control-prestamos-local");
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction("vault", "readonly").objectStore("vault").get("primary");
        get.onsuccess = () => { resolve(get.result); db.close(); };
        get.onerror = () => { reject(get.error); db.close(); };
      };
      request.onerror = () => reject(request.error);
    });
    return {
      queueEntities: vault.queue.map(entry => entry.entity),
      pendingCount: vault.queue.length,
      containsPlaintext: JSON.stringify(raw).includes("Nuevo Cliente Offline"),
      totalLoans: vault.loans.length
    };
  });
  expect(stored.queueEntities).toEqual(["payments", "customers", "loans"]);
  expect(stored.pendingCount).toBe(3);
  expect(stored.containsPlaintext).toBeFalsy();
  expect(stored.totalLoans).toBe(2);

  await page.reload();
  await expect(page.locator("#pin-unlock-form")).toBeVisible();
  await page.locator("#operator-pin").fill("4826");
  await page.locator("#unlock-submit").click();
  await expect(page.locator("#record-list")).toContainText("Nuevo Cliente Offline");
  const afterReload = await page.evaluate(async () => {
    const store = await import("./src/offline-store.js");
    return store.getVault().queue.length;
  });
  expect(afterReload).toBe(3);
});
