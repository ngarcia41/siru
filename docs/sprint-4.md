# Sprint 4: Informes, ajustes y puesta en línea

- **Contenido:** HU-06 (5 puntos), el cierre de las brechas B-04 a B-13, el despliegue con HTTPS y el apoyo a la validación con vecinos.
- **Fechas:** el Gantt planificó este sprint y las pruebas del 02/11 al 11/11, y la documentación final y la demo del 12/11 al 18/11.
- **Si no alcanza el tiempo:** el plan del riesgo R05 permite postergar HU-06. Por eso el orden recomendado es
  despliegue y brechas que afectan a la validación (B-07, B-09, B-04 y B-05) → validación con vecinos → HU-06 → resto de las brechas.
- Antes de empezar, las tareas de este sprint se detallan con el mismo formato que `sprint-3.md`.

## HU-06: Informe de zonas críticas (Media, 5 puntos, depende de HU-04)

Como operador, quiero emitir un informe de zonas críticas, para presentarlo ante el municipio como respaldo de los reclamos.

1. Dado un rango de fechas y una zona, cuando el operador solicita el informe, entonces el sistema genera un documento PDF con el resumen por categoría y severidad, el mapa de calor y los 10 incidentes de mayor índice de prioridad.
2. Dado el listado de incidentes del informe, cuando se genera, entonces incluye la dirección aproximada, los días activos y la cantidad de confirmaciones de cada uno.
3. Dado que no existen incidentes activos en la zona y el período, cuando se solicita el informe, entonces el sistema lo informa sin generar el documento.

**Puntos que el documento no define** (proponer y registrar en `decisiones.md` antes de programar):
- **Cómo se elige la zona:** el área visible del mapa, un rectángulo dibujado o un radio alrededor de un punto.
- **De dónde sale la dirección aproximada:** la base no guarda direcciones. Una opción es geocodificar al revés
  con Nominatim de OpenStreetMap al generar el informe. Son solo 10 consultas y respetando su política de uso (una por
  segundo e identificación del cliente). Se envían las coordenadas del incidente, nunca las del usuario.
- **Cómo se genera el PDF:**
  - en el navegador, a partir de una página de informe con el mapa ya dibujado;
  - en el servidor, con una biblioteca de PDF más una imagen estática del mapa;
  - en el servidor, con un navegador sin interfaz.
  - Comparar el peso de cada opción en Docker y su riesgo, y elegir una antes de programar.
- **Auditoría:** emitir el informe es una acción del operador; registrarla como `EMITE_INFORME`.

## Brechas pendientes

Están detalladas en `decisiones.md`, en la tabla de brechas.

| ID | Tarea | Nota |
|---|---|---|
| B-07 | Envío real de correos (SMTP) | Con `MODO_CORREO=smtp` y las credenciales en `.env`. Hace falta antes de que se registren vecinos reales |
| B-06 | Restablecer la contraseña por correo | Enlace de un solo uso, guardado como hash y válido por un tiempo limitado. Proponer el plazo |
| B-09 | Consentimiento informado en el registro | Texto breve con la finalidad y los derechos de la Ley 25.326; casilla obligatoria. Proponer dónde queda registrado sin cambiar la base, por ejemplo en el detalle de la auditoría de `REGISTRO_USUARIO` |
| B-04 / B-05 | Antigüedad de la posición, velocidad entre acciones y coordenadas de confirmación durante 90 días | D-08 está aprobada (Opción A): migración nueva con `confirmacion.ubicacion` y actualización de `modelo-datos.md` y `der.mmd`. La purga se suma a `tareas:diarias` |
| B-08 | Aviso 7 días antes del vencimiento de la contraseña | |
| B-10 | Ocultar imágenes con rostros o patentes | Propuesta sin cambiar la base: eliminar la miniatura pública, conservar el original privado, mostrar "imagen oculta por privacidad" y auditar `OCULTA_IMAGEN` |
| B-11 | Modificación y baja de la cuenta del vecino | La baja choca con la auditoría inmutable. Proponer anonimizar los datos o corregir el texto del documento |

## Despliegue (Opción B del documento)

- Dockerfile de la aplicación y `docker-compose.yml` con la aplicación, PostgreSQL 17 con PostGIS y el proxy inverso.
- HTTPS con certificado automático, más el límite de solicitudes por IP en el proxy (B-12). Comparar nginx y Caddy
  según cuál permite limitar las solicitudes sin módulos adicionales.
- Implementación de Spaces (S3) para la interfaz de almacenamiento de D-14.
- `cron` en el servidor para `tareas:diarias` (00:30) y para los respaldos (B-13): completo los domingos a las 02:00
  e incremental de lunes a sábado a las 02:00, con pg_basebackup de PostgreSQL 17 (requiere `summarize_wal`).
  Las copias se cifran y se registra su hash, según la política 3-2-1 del documento.
- Variables de entorno de producción documentadas en `.env.example`, sin valores reales.

## Apoyo a la validación con vecinos

- **Medición del tiempo de registro** (meta: menos de 3 minutos). El formulario envía cuándo se abrió, y el servidor
  guarda la duración en el detalle de la auditoría de `ALTA_INCIDENTE`. No hace falta cambiar la base.
- **Script de métricas** (`npm run metricas`). Debe informar:
  - el tiempo de registro (mediana y máximo);
  - los duplicados detectados, por cercanía y por imagen;
  - las lecturas GPS rechazadas por precisión;
  - las confirmaciones rechazadas por distancia.
  Son los indicadores de la tabla "Parámetros configurables y su revisión en la validación".
- La encuesta SUS se aplica fuera del sistema.
