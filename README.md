# Control Préstamos

Aplicación Android-first para registrar préstamos y abonos con una interfaz sencilla para el operador y un panel de control para el propietario.

## Objetivo del producto
- **Modo sencillo (operador):** registrar préstamos, registrar abonos y consultar saldos con pasos mínimos.
- **Modo propietario:** consultar capital prestado, recuperaciones, saldo pendiente, historial, clientes y auditoría.
- Ambas interfaces deben usar la misma fuente de datos y permisos basados en roles.

## Estado actual
Esta primera entrega establece un prototipo web responsive, lógica financiera probada y controles automatizados. La APK y la sincronización segura entre dispositivos son etapas posteriores; no se debe tratar este prototipo como sistema de producción ni almacenar datos financieros reales todavía.

## Requisitos
- Node.js 22 o superior
- npm

## Desarrollo y pruebas
```bash
npm install
npm run dev
npm test
npx playwright install --with-deps chromium
npm run test:e2e
npm run test:a11y
npm run test:responsive
npm run quality
```

## Decisiones de arquitectura
Consulta [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TESTING.md](docs/TESTING.md) y [docs/ANDROID-ROADMAP.md](docs/ANDROID-ROADMAP.md).

## Seguridad y alcance
- La interfaz de demostración guarda datos de ejemplo en el almacenamiento local del navegador. Esto **no** proporciona autenticación real, respaldo ni sincronización.
- No introducir datos personales o financieros reales en el prototipo.
- En producción, el servidor debe validar cada operación y autorización; ocultar botones no es control de acceso.
- Los importes de la lógica de dominio se expresan en centavos enteros para evitar errores de coma flotante.
