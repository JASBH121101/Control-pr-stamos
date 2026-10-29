# Decisiones de arquitectura

## Objetivo
Mantener la experiencia de uso simple para el operador y ofrecer una vista ampliada para el propietario sin duplicar la lógica ni los registros.

## Capas
- **Presentación:** HTML semántico, CSS responsive y módulos JavaScript nativos.
- **Dominio:** `src/domain/loans.js` contiene operaciones puras para crear préstamos, registrar abonos, calcular saldos y resumir cartera.
- **Persistencia de prototipo:** `localStorage`, solo para demostración en un navegador y sin datos reales.
- **Calidad:** Node test runner para dominio y Playwright + axe-core para flujos, accesibilidad y tamaños de pantalla.
- **Android:** la estrategia prevista es empaquetar la interfaz web como APK (por ejemplo, Capacitor) después de validar flujos, almacenamiento seguro y estrategia de sincronización.

## Decisiones
1. **Diseño mobile-first:** el operador usará principalmente un teléfono y necesita acciones principales visibles, textos directos y botones amplios.
2. **Dos modos, una sola aplicación:** sencillo y propietario son vistas distintas de la misma cartera. En esta demostración, el cambio de modo es solo visual y no constituye autenticación ni autorización.
3. **Importes en centavos enteros:** evita errores comunes de aritmética con números decimales en operaciones financieras.
4. **Sin framework de UI por ahora:** la aplicación inicial es pequeña y no necesita una cadena de compilación compleja. Los módulos nativos facilitan su revisión y el empaquetado posterior.
5. **Sin backend aún:** primero se validan el flujo y el dominio. Antes de usar dinero real se requiere API/base de datos, autenticación, roles, auditoría inmutable, copias de seguridad y reglas de recuperación.
6. **No asumir reglas de crédito:** intereses, multas, pagos parciales, vencimientos y calendario deben definirse con el propietario antes de implementarse.

## Modelo inicial
Un préstamo contiene cliente, capital inicial, suma abonada, saldo calculado, nota, fecha de creación y una lista de pagos. La versión actual no modela aún cuotas, intereses ni vencimientos.
