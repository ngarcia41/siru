# Modelo de datos (fuente: Entrega 4)

Fuente: sección "Estructura de Datos" del documento, que incluye el DER en notación de pata de gallo (*crow's foot*)
y el diccionario de datos. El diagrama en texto está en `docs/der.mmd`, que es el archivo del que sale la figura del documento.

**Estado al cierre del Sprint 2:** `db/migraciones/001_esquema_inicial.sql` implementa las 9 entidades del DER
con todos sus campos, tipos y restricciones. Las únicas diferencias son de nomenclatura: el documento escribe los
campos en PascalCase (`IncidenteID`) y el SQL en snake_case (`incidente_id`).

**Regla:** un cambio en esta estructura requiere aprobación previa, una migración nueva, actualizar este archivo
y `der.mmd`, y una entrada en `decisiones.md`.

## Relaciones (cardinalidad del DER)

| Relación | Cardinalidad | Clave foránea en SQL |
|---|---|---|
| USUARIO registra INCIDENTE | 1 a 0..N | `incidente.usuario_id` |
| USUARIO emite CONFIRMACION | 1 a 0..N | `confirmacion.usuario_id` |
| USUARIO informa RESOLUCION | 1 a 0..N | `resolucion.informada_por` |
| USUARIO (operador) valida RESOLUCION | 0..1 a 0..N | `resolucion.validada_por` (NULL hasta la validación) |
| USUARIO posee HISTORIAL_CONTRASENA | 1 a 0..N | `historial_contrasena.usuario_id` |
| USUARIO genera AUDITORIA | 1 a 0..N | `auditoria.usuario_id` |
| USUARIO inicia SESION | 1 a 0..N | `sesion.usuario_id` |
| CATEGORIA clasifica INCIDENTE | 1 a 0..N | `incidente.categoria_id` |
| SEVERIDAD pondera INCIDENTE | 1 a 0..N | `incidente.severidad_id` |
| INCIDENTE recibe CONFIRMACION | 1 a 0..N | `confirmacion.incidente_id` |
| INCIDENTE tiene RESOLUCION | 1 a 0..N | `resolucion.incidente_id` |
| INCIDENTE es objeto de AUDITORIA | 0..1 a 0..N | `auditoria.incidente_id` (NULL en acciones sin incidente) |

## USUARIO (`usuario`)

| Campo (documento) | Columna SQL | Tipo | Restricciones | Significado |
|---|---|---|---|---|
| UsuarioID | usuario_id | INT (SERIAL) | PK | Identificador único |
| Email | email | VARCHAR(120) | NOT NULL, UNIQUE | Correo verificado; es la credencial de acceso |
| HashContrasena | hash_contrasena | VARCHAR(60) | NOT NULL | Hash bcrypt (incluye la sal y el costo) |
| Rol | rol | VARCHAR(10) | CHECK VECINO u OPERADOR | Perfil |
| EstadoCuenta | estado_cuenta | VARCHAR(12) | CHECK PENDIENTE, ACTIVA, BLOQUEADA o SUSPENDIDA; DEFAULT PENDIENTE | PENDIENTE significa que el correo no está verificado |
| IntentosFallidos | intentos_fallidos | SMALLINT | DEFAULT 0 | Intentos fallidos consecutivos |
| BloqueadoHasta | bloqueado_hasta | TIMESTAMPTZ | | Fin del bloqueo temporal |
| DebeCambiarClave | debe_cambiar_clave | BOOLEAN | DEFAULT FALSE | Cambio obligatorio en el próximo ingreso |
| FechaCambioClave | fecha_cambio_clave | TIMESTAMPTZ | DEFAULT now() | Último cambio de contraseña |
| UltimoAcceso | ultimo_acceso | TIMESTAMPTZ | | Último ingreso exitoso |
| FechaRegistro | fecha_registro | TIMESTAMPTZ | DEFAULT now() | Alta en el sistema |
| TokenVerificacionHash | token_verificacion_hash | CHAR(64) | | SHA-256 del enlace de verificación (nunca el enlace en claro) |
| TokenVerificacionVence | token_verificacion_vence | TIMESTAMPTZ | | Vence a las 24 horas |

## SESION (`sesion`)

| Campo | Columna SQL | Tipo | Restricciones | Significado |
|---|---|---|---|---|
| SesionID | sesion_id | UUID | PK | Viaja en el JWT (`sid`) |
| UsuarioID | usuario_id | INT | FK, ON DELETE CASCADE | |
| Creada | creada | TIMESTAMPTZ | DEFAULT now() | La duración máxima es de 8 horas |
| UltimaActividad | ultima_actividad | TIMESTAMPTZ | DEFAULT now() | Controla la inactividad (30 minutos para el vecino, 15 para el operador) |
| RevocadaEn | revocada_en | TIMESTAMPTZ | | Invalidación desde el servidor |
| DireccionIP | direccion_ip | VARCHAR(45) | | |

## HISTORIAL_CONTRASENA (`historial_contrasena`)

Contiene `historial_id` (PK), `usuario_id` (FK), `hash_contrasena` (VARCHAR(60)) y `fecha_alta` (TIMESTAMPTZ).
Sirve para impedir que se repita cualquiera de las últimas 3 contraseñas.

## CATEGORIA (`categoria`) y SEVERIDAD (`severidad`)

- **CATEGORIA:** `categoria_id` SMALLINT PK y `nombre` VARCHAR(30) UNIQUE. Los valores son 1 Bache, 2 Luminaria,
  3 Anegamiento, 4 Basura acumulada y 5 Otro.
- **SEVERIDAD:** `severidad_id` SMALLINT PK, `nombre` VARCHAR(10) UNIQUE, `peso` NUMERIC(3,2) y `criterio` VARCHAR(200).
  Los valores son 1 baja (0,33), 2 media (0,67) y 3 alta (1,00). **`peso` es el valor S del índice de prioridad.**

## INCIDENTE (`incidente`)

| Campo | Columna SQL | Tipo | Restricciones | Significado |
|---|---|---|---|---|
| IncidenteID | incidente_id | INT (SERIAL) | PK | |
| UsuarioID | usuario_id | INT | FK, NOT NULL | Vecino que reportó |
| CategoriaID | categoria_id | SMALLINT | FK | |
| SeveridadID | severidad_id | SMALLINT | FK | Severidad vigente (el operador puede reclasificarla) |
| Descripcion | descripcion | VARCHAR(200) | NOT NULL | |
| Ubicacion | ubicacion | GEOMETRY(Point, 4326) | NOT NULL; índices GiST sobre la geometría y sobre `ubicacion::geography` | Coordenadas del incidente |
| PrecisionGPS | precision_gps | NUMERIC(6,1) | | En metros; el máximo aceptado es 25 |
| FotoRuta | foto_ruta | VARCHAR(255) | | El documento dice "ruta de la imagen original". Con D-19 guarda la clave de la versión reducida (privada); queda NULL en el Sprint 2 |
| HashFoto | hash_foto | CHAR(64) | NOT NULL, UNIQUE | SHA-256 de la imagen |
| FechaCapturaFoto | fecha_captura_foto | TIMESTAMPTZ | | Fecha EXIF, si existe (en el Sprint 2 queda NULL) |
| PuntajeConfianza | puntaje_confianza | SMALLINT | DEFAULT 1, CHECK ≥ 0 | Empieza en 1 y suma 1 por confirmación |
| Estado | estado | VARCHAR(15) | CHECK SIN_VERIFICAR, ACTIVO, EN_REVISION, RESUELTO o DESESTIMADO | |
| IndicePrioridad | indice_prioridad | NUMERIC(5,2) | | De 0 a 100, **solo para incidentes activos** |
| FechaCreacion | fecha_creacion | TIMESTAMPTZ | DEFAULT now() | |
| FechaActivacion | fecha_activacion | TIMESTAMPTZ | | Momento en que llega a 3 puntos; base del componente T |
| FechaCierre | fecha_cierre | TIMESTAMPTZ | | Cierre (resuelto o desestimado) |

## CONFIRMACION (`confirmacion`)

| Campo | Columna SQL | Tipo | Restricciones | Significado |
|---|---|---|---|---|
| ConfirmacionID | confirmacion_id | INT (SERIAL) | PK | |
| IncidenteID | incidente_id | INT | FK | |
| UsuarioID | usuario_id | INT | FK | |
| DistanciaMetros | distancia_metros | NUMERIC(6,1) | NOT NULL, CHECK < 50 | Distancia medida por PostGIS al confirmar |
| PrecisionGPS | precision_gps | NUMERIC(6,1) | | |
| FechaConfirmacion | fecha_confirmacion | TIMESTAMPTZ | DEFAULT now() | |
| (IncidenteID, UsuarioID) | `confirmacion_unica` | | UNIQUE | Nadie confirma dos veces el mismo incidente |

> **Cambio aprobado (D-08, Opción A, 09/11/2026):** en el Sprint 4 se agrega `ubicacion GEOMETRY(Point, 4326) NULL`
> con una migración nueva. La tarea diaria la pone en NULL a los 90 días. Al aplicarlo, actualizar esta tabla y `der.mmd`
> en el mismo commit. Hasta entonces, esta tabla refleja el esquema vigente.

## RESOLUCION (`resolucion`)

| Campo | Columna SQL | Tipo | Restricciones | Significado |
|---|---|---|---|---|
| ResolucionID | resolucion_id | INT (SERIAL) | PK | |
| IncidenteID | incidente_id | INT | FK | |
| InformadaPor | informada_por | INT | FK, NOT NULL | Vecino u operador que informa la resolución |
| FechaInforme | fecha_informe | TIMESTAMPTZ | DEFAULT now() | |
| EvidenciaRuta | evidencia_ruta | VARCHAR(255) | | Clave de la foto reducida o del PDF de evidencia |
| HashEvidencia | hash_evidencia | CHAR(64) | | SHA-256 de la evidencia |
| Observacion | observacion | VARCHAR(300) | | Motivo del rechazo o comentario del operador |
| ValidadaPor | validada_por | INT | FK, NULL | Operador que valida o rechaza |
| FechaValidacion | fecha_validacion | TIMESTAMPTZ | | |
| Resultado | resultado | VARCHAR(10) | CHECK PENDIENTE, CONFIRMADA o RECHAZADA; DEFAULT PENDIENTE | |

## AUDITORIA (`auditoria`)

Contiene `auditoria_id` (BIGSERIAL PK), `usuario_id` (FK, NULL), `incidente_id` (FK, NULL), `accion` (VARCHAR(40)),
`detalle` (JSONB con los valores anteriores y nuevos), `direccion_ip` (VARCHAR(45)) y `fecha_hora` (TIMESTAMPTZ).
Es de **solo inserción**: los disparadores `auditoria_sin_cambios` y `auditoria_sin_vaciado` rechazan UPDATE, DELETE y TRUNCATE.
Por eso **ningún dato que deba borrarse más adelante puede guardarse en la auditoría** (por ejemplo, las coordenadas de una persona).

## Objetos técnicos fuera del DER

No representan datos del negocio, así que no figuran en el DER:

- la tabla `migracion`, que registra las migraciones aplicadas;
- los índices (GiST espaciales y los que aceleran los conteos de los límites diarios y la auditoría);
- la función y los disparadores que hacen inmutable la auditoría.
