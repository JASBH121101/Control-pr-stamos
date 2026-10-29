import { test, expect } from "@playwright/test";

for (const width of [360,390,430,768,1024,1280,1440]) {
  test(`login and text controls fit viewport at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({width,height:900});
    await page.goto("/");
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator("#auth-panel")).toBeVisible();
    await expect(page.getByRole("slider",{name:"Nivel de tamaño del texto"})).toBeVisible();
    await expect(page.getByLabel("Correo electrónico")).toBeVisible();
    const dims=await page.evaluate(()=>({viewport:window.innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
    expect(dims.document,JSON.stringify(dims)).toBeLessThanOrEqual(width);
    await page.screenshot({path:testInfo.outputPath(`responsive-${width}.png`),fullPage:true});
  });
}
