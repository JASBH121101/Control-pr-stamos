import { mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("reports", { recursive: true });
let result;
try {
  result = JSON.parse(await readFile("test-results/playwright-results.json", "utf8"));
} catch {
  result = null;
}
const counts = { passed: 0, failed: 0, skipped: 0, timedOut: 0, interrupted: 0 };
const failures = [];
function visit(suites = []) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const last = test.results?.at(-1);
        const status = last?.status ?? test.status ?? "skipped";
        if (status in counts) counts[status] += 1;
        if (status !== "passed") failures.push(`- **${status}** — ${spec.title}${last?.error?.message ? `: ${last.error.message.split("\n")[0]}` : ""}`);
      }
    }
    visit(suite.suites);
  }
}
if (result) visit(result.suites);
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const lines = [
  "# Auditoría automatizada de calidad — Control Préstamos",
  "",
  `- Generado: ${new Date().toISOString()}`,
  `- Entorno CI: ${process.env.GITHUB_ACTIONS ? "GitHub Actions" : "local"}`,
  `- Resultado de pruebas Playwright: ${result ? "resultados encontrados" : "sin archivo JSON; ejecutar pruebas E2E primero"}`,
  "",
  "## Resumen E2E",
  "",
  `- Total de ejecuciones: ${total}`,
  `- Aprobadas: ${counts.passed}`,
  `- Fallidas: ${counts.failed}`,
  `- Omitidas: ${counts.skipped}`,
  `- Timeout: ${counts.timedOut}`,
  `- Interrumpidas: ${counts.interrupted}`,
  "",
  "## Hallazgos",
  "",
  ...(failures.length ? failures : ["No se registraron fallos en los resultados disponibles."]),
  "",
  "## Límites de esta auditoría",
  "",
  "- La suite verifica reglas de dominio, flujos de interfaz, accesibilidad automatizada y ausencia de desbordamiento horizontal en 360, 390, 430, 768, 1024, 1280 y 1440 px.",
  "- Las capturas se guardan como artefactos para inspección visual; no equivalen a una comparación pixel a pixel contra una línea base aprobada.",
  "- La suite automatizada de esta versión cubre autenticación como interfaz, accesibilidad y responsive; las comprobaciones con credenciales reales, sincronización entre usuarios/dispositivos y la publicación Android deben validarse aparte.",
  ""
];
await writeFile("reports/quality-audit.md", lines.join("\n"));
console.log("Reporte escrito en reports/quality-audit.md");
