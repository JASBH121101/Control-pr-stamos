# Ruta hacia la APK

## Fase 1 — Prototipo y pruebas
- [x] Interfaz inicial para modo sencillo y modo propietario.
- [x] Lógica de dominio con dinero en centavos.
- [x] Suite unitaria y pruebas de navegador.
- [x] Auditoría de accesibilidad y responsive.
- [ ] Revisar la app en teléfono real con el operador.

## Fase 2 — Acordar reglas de negocio
Confirmar: moneda, intereses, fechas de vencimiento, pagos parciales, pagos adelantados, recibos, refinanciamientos, clientes con varios préstamos y tratamiento de pagos que cubren varios conceptos.

## Fase 3 — Datos seguros y roles
- Backend y base de datos centralizada.
- Cuenta de propietario y cuenta de operador separadas.
- Permisos verificados en el servidor; el operador no puede borrar movimientos ni cambiar saldos históricos.
- Historial de auditoría para altas, abonos, correcciones y anulaciones.
- Respaldo y exportación recuperable.
- No guardar claves de servicio ni secretos de administración dentro de la APK.

## Fase 4 — APK instalable
Evaluar Capacitor para Android, configurar icono/nombre/paquete, pantalla de inicio, política de almacenamiento, conexión a API, tratamiento de conexión intermitente y pruebas en dispositivos físicos. Entregar APK de debug para validación; firmar una versión de distribución solo después de las pruebas y configuración de claves.

## Criterio de salida
No considerar lista la app para dinero real hasta que la identidad de usuario y los permisos funcionen en backend, los movimientos tengan trazabilidad y la información se pueda respaldar y restaurar.
