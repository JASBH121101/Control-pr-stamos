# Estrategia de pruebas

## Capas
- **Unitarias:** conversión monetaria, validación de cliente/capital/abono, saldo pendiente y totales agregados.
- **E2E:** carga, cambio de modo, alta de préstamo, validación de abono superior al saldo y búsqueda.
- **Accesibilidad:** axe-core para WCAG 2.1 A/AA y etiquetas accesibles en el formulario.
- **Responsive:** ejecución Chromium a 360, 390, 430, 768, 1024, 1280 y 1440 px; detecta scroll horizontal y guarda capturas.
- **Reporte:** `npm run report` genera `reports/quality-audit.md`; el workflow conserva capturas, trazas, HTML y JSON como artefactos por 14 días.

## Comandos
```bash
npm test
npm run test:e2e
npm run test:a11y
npm run test:responsive
npm run report
```

## Interpretación
Un test aprobado no garantiza que la aplicación sea segura ni que cubra todos los errores visuales. Las capturas de viewport sirven para inspección humana; la comparación visual pixel a pixel necesita líneas base aprobadas y mantenidas deliberadamente. Las pruebas CI no deben conectarse a datos reales.
