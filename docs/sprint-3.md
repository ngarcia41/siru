# Sprint 3: Priorización y cierre con evidencia

- **Historias:** HU-04 (8 puntos) y HU-05 (8 puntos), 16 puntos en total, según el Product Backlog del documento.
- **Objetivo del sprint:** que el operador vea los incidentes activos ordenados por prioridad y que el cierre de un
  incidente quede respaldado por evidencia, con quién la informó y quién la validó.
- **Fechas:** el Gantt del documento planificó este sprint del 19/10 al 01/11. Las fechas reales se registran en "Cierre".
  El desvío corresponde al riesgo R05, cuyo plan prioriza las historias del núcleo y permite postergar HU-06.
- **Decisiones:** D-06 a D-20 de `decisiones.md` quedaron aprobadas el 09/11/2026 (D-08, con la Opción A).
  Las fotos se manejan según `imagenes.md`: se implementa lo que dice el
  documento, más el único ajuste D-19, sin funciones nuevas.

## Historias de usuario (texto del documento, sin cambios)

### HU-04: Priorización de incidentes y mapa de calor (Alta, 8 puntos, depende de HU-03)

Como operador, quiero ver los incidentes activos ordenados por índice de prioridad y representados en un mapa de calor,
para decidir qué reclamos elevar primero.

1. Dado un incidente Activo, cuando cambia su puntaje de confianza o transcurre un día, entonces el sistema recalcula su índice de prioridad con la fórmula definida.
2. Dado el panel de incidentes, cuando el usuario lo abre, entonces visualiza la lista ordenada por índice de prioridad con su banda (alta, media o baja).
3. Dada la capa de calor activada, cuando se muestra el mapa, entonces solo se incluyen los incidentes Activos, ponderados por su índice de prioridad.
4. Dado que el operador reclasifica la severidad de un incidente, cuando guarda el cambio, entonces se recalcula el índice y se registra la acción en la auditoría.

### HU-05: Informe y validación de la resolución con evidencia (Alta, 8 puntos, depende de HU-03)

Como vecino, quiero informar que un incidente fue reparado, y como operador, quiero validar esa información con evidencia,
para que el cierre quede registrado de forma confiable.

1. Dado un incidente Activo, cuando un vecino ubicado a menos de 50 metros informa la resolución adjuntando una fotografía, entonces el incidente pasa a En revisión y se registran quién informó y cuándo.
2. Dado un incidente En revisión, cuando el operador valida la evidencia, entonces pasa a Resuelto con su fecha de cierre y el operador responsable.
3. Dado que el operador rechaza la evidencia, cuando registra una observación, entonces el incidente vuelve a Activo.
4. Dado un reporte falso o ajeno al alcance, cuando el operador lo desestima con una observación, entonces pasa a Desestimado.

## Sprint Backlog

| Historia | ID | Tarea | Prioridad | Estimado | Estado |
|---|---|---|---|---|---|
| Técnica | T01 | Correr las pruebas sobre una base aislada con `npm run prueba` (D-17) | Alta | 0,5 día | Hecha (09/11/2026) |
| HU-05 | T02 | Reducir la foto en el teléfono (1600 px, sin metadatos), calcular allí la huella y el EXIF del original, y subirla al servidor (B-02, D-19) | Alta | 1,5 días | Hecha (09/11/2026) |
| HU-05 | T03 | Controles EXIF en el servidor (fecha de 24 h como máximo, coordenadas a menos de 50 m) y `fecha_captura_foto` (B-01); cámara en el selector de foto (D-22) | Media | 0,5 día | Hecha (09/11/2026) |
| HU-05 | T04 | Recodificar en el servidor, guardar la foto privada y la miniatura de 480 px, y servirlas por una ruta autenticada (B-03, D-14); fecha EXIF futura (D-23) | Alta | 1 día | Hecha (09/11/2026) |
| HU-04 | T05 | Calcular el índice de prioridad al activar y con cada confirmación (D-06) | Alta | 1 día | Hecha (09/11/2026) |
| HU-04 | T06 | Tarea diaria de las 00:30 que recalcula los índices (D-07) | Alta | 0,5 día | Pendiente |
| HU-04 | T07 | Reclasificar la severidad y la categoría (operador), con recálculo y auditoría (D-13) | Alta | 1 día | Pendiente |
| HU-04 | T08 | Panel ordenado por índice con su banda; mapa de calor de los activos ponderado por el índice | Alta | 1 día | Pendiente |
| HU-05 | T09 | Informe de la resolución por el vecino (a menos de 50 m, con foto) y por el operador (información oficial) (D-10, D-11) | Alta | 1,5 días | Pendiente |
| HU-05 | T10 | Validar o rechazar la resolución (observación obligatoria al rechazar) (D-18) | Alta | 1 día | Pendiente |
| HU-05 | T11 | Desestimar con observación obligatoria y suspender tras 3 desestimados en 30 días (D-09, D-12) | Alta | 1 día | Pendiente |
| HU-05 | T12 | Pantallas: informar la resolución (vecino) y bandeja del operador con la evidencia y las acciones | Alta | 1,5 días | Pendiente |
| Técnica | T13 | Pruebas de HU-04 y HU-05, y adecuación de las 42 pruebas anteriores | Alta | 1 día | Pendiente |
| Técnica | T14 | Semilla con imágenes e índices, README y cierre del sprint | Media | 0,5 día | Pendiente |

## Especificación por tarea

### T01: pruebas aisladas
- Agregar el script `npm run prueba`, que:
  - recrea `siru_prueba` (DROP y CREATE), migra y carga la semilla;
  - levanta el servidor en el puerto 3001 contra esa base;
  - corre `pruebas/*.prueba.ts` y apaga el servidor.
- La URL de la base de prueba va en `DATABASE_URL_PRUEBA` dentro de `.env`. Documentarlo en `.env.example`, sin valores reales.
- **Si el nombre de la base no es `siru_prueba`, el script aborta.**
- El resultado esperado al terminar T01 son las 42 pruebas en verde, sin cambios en el código del sistema.

### T02 a T04: imagen (seguir `imagenes.md`)
- **En el teléfono** (`src/lib/cliente/imagen.ts`, nuevo):
  - sobre el original se calcula la huella SHA-256 (como hoy), se controla el tamaño mínimo (D-04) y se leen la
    fecha y las coordenadas EXIF con `exifr`;
  - después se genera la versión reducida: lado mayor de 1600 px como máximo, JPEG con calidad 0,8, orientación
    corregida y sin metadatos. Si se puede, se decodifica directamente a tamaño reducido para cuidar la memoria;
  - si no se puede abrir la imagen, se muestra un mensaje claro y no se sube nada.
  - Reemplaza la simulación de `exif.ts`.
- **Envío:** `POST /api/incidents` pasa a `multipart/form-data`. Los campos son los actuales más:
  - el archivo `foto` reducido;
  - `hashOriginal`;
  - `exifFecha` y `exifLat`/`exifLng`, si existen;
  - la hora de la lectura GPS (`posicionTomadaEn`), que se usará en B-04.
- **Validación en el servidor:**
  - solicitud de más de 1,5 MB: 413 `IMAGEN_DEMASIADO_GRANDE`;
  - imagen que no es JPEG por su firma, que tiene el lado mayor fuera del rango de 800 a 1600 px o que `sharp` no
    puede decodificar: 400 `IMAGEN_INVALIDA`;
  - `hashOriginal` repetido: sigue respondiendo 409 `FOTO_DUPLICADA`.
- **EXIF** (con los datos declarados, D-16):
  - fecha de captura con más de 24 h: 422 `FOTO_ANTIGUA`;
  - coordenadas a 50 m o más de la posición del dispositivo, medidas con PostGIS: 422 `FOTO_LEJANA`;
  - la fecha se guarda en `fecha_captura_foto`.
- **Almacenamiento** (D-14):
  - interfaz `src/lib/servidor/almacenamiento.ts`, con la implementación local en `almacenamiento/` (agregar la carpeta a `.gitignore`);
  - versiones generadas con `sharp().rotate()`, siempre sin metadatos:
    - `fotos/<hash>.jpg` (hasta 1600 px, calidad 80);
    - `miniaturas/<hash>.jpg` (hasta 480 px, calidad 70);
  - `foto_ruta` guarda la clave de `fotos/`;
  - las constantes de tamaño van en `reglas.ts`.
- **Ruta de lectura:** `GET /api/imagenes/[tipo]/[clave]` exige sesión.
  - Valida la clave con una expresión estricta (hash de 64 caracteres hexadecimales más la extensión), para evitar el recorrido de rutas.
  - Las miniaturas se entregan a cualquier usuario autenticado; la foto privada, solo al operador.
  - Responde con `Cache-Control: private, max-age=604800, immutable`.
- **Cliente:**
  - el formulario de alta envía la versión reducida;
  - el mapa no carga fotos;
  - al abrir un incidente se carga la miniatura;
  - el operador ve la foto privada en su bandeja.
  - **No agregar** modos, opciones ni pantallas que no estén en el documento (ver lo descartado en `imagenes.md`).

### T05 a T08: índice de prioridad (HU-04)
- **Constantes nuevas en `reglas.ts`:**
  - `PESOS_PRIORIDAD = { S: 0.5, C: 0.3, T: 0.2 }`
  - `PUNTOS_RESPALDO_MAXIMO = 6`
  - `DIAS_ANTIGUEDAD_MAXIMA = 30`
  - `BANDAS_PRIORIDAD = { alta: 70, media: 40 }`
  - `HORA_RECALCULO = "00:30"`
- **Una sola implementación del cálculo:** `src/lib/servidor/prioridad.ts`, con
  `recalcularIndices(c, { incidenteId? })`, que ejecuta un único UPDATE parametrizado sobre los incidentes ACTIVO
  (uno o todos) haciendo JOIN con `severidad.peso`.
  La fórmula es `round(100 × (S·peso + C·min(puntos/6, 1) + T·min(floor(días)/30, 1)), 2)` (D-06).
  Fuera de ACTIVO, el índice queda en NULL.
- **Cuándo se recalcula:**
  - al activar el incidente y con cada confirmación sobre uno activo, dentro de la misma transacción;
  - al cambiar la severidad;
  - al volver a ACTIVO después de un rechazo;
  - en la tarea diaria.
- **Tarea diaria:** `scripts/tareas-diarias.ts` (`npm run tareas:diarias`) recalcula todos los índices. Se deja
  preparada para sumar la purga de coordenadas (D-08) en el Sprint 4.
- **Reclasificación:** `PATCH /api/incidents/[id]` con `{ action: "reclasificar", severidad?, categoria? }`, solo para
  el operador y sobre incidentes no cerrados. Audita `CAMBIO_SEVERIDAD` o `CAMBIO_CATEGORIA` con los valores anteriores
  y nuevos, más el índice anterior y el nuevo.
- **API y panel:**
  - `GET /api/incidents` devuelve `indicePrioridad` y `bandaPrioridad`;
  - el panel muestra primero los activos, ordenados por índice de mayor a menor y con la banda visible; después los demás, por fecha.
- **Mapa de calor:** solo incidentes ACTIVO, con un peso de `indicePrioridad / 100`. Reemplaza el `trustPoints / 5` actual.

### T09 a T12: resolución y desestimación (HU-05)
- **Informar la resolución:** `POST /api/incidents/[id]/resolucion` (multipart).
  - **Vecino:** el incidente debe estar ACTIVO; la distancia con ST_Distance debe ser menor a 50 m y la precisión de
    25 m o menos. La foto es obligatoria y pasa por el mismo control de T02 y T03.
  - **Operador:** el incidente debe estar ACTIVO. La evidencia es obligatoria (foto, o PDF como información oficial) y no hay control de distancia.
  - **Unicidad:** el hash de la evidencia no puede existir ni en `incidente.hash_foto` ni en `resolucion.hash_evidencia` (D-11).
  - **Efecto:** crea la RESOLUCION como PENDIENTE (`informada_por`, `fecha_informe`, `evidencia_ruta`, `hash_evidencia`).
    El incidente pasa a EN_REVISION con el índice en NULL. Se audita `INFORMA_RESOLUCION` con el perfil, la distancia
    (si informó un vecino) y el hash.
- **Validar o rechazar:** `POST /api/incidents/[id]/resolucion/validar`, con `{ resultado: "CONFIRMADA" | "RECHAZADA", observacion }`. Solo para el operador.
  - **CONFIRMADA:** completa `validada_por`, `fecha_validacion` y `resultado`. El incidente pasa a RESUELTO con su
    `fecha_cierre`. Se audita `VALIDA_RESOLUCION`.
  - **RECHAZADA:** la observación es obligatoria (al menos 10 caracteres) y se guarda en `resolucion.observacion`.
    El incidente vuelve a ACTIVO y se recalcula su índice. Se audita `RECHAZA_RESOLUCION`. La evidencia se conserva.
- **Desestimar:** `POST /api/incidents/[id]/desestimar` con `{ observacion }`. Solo para el operador y desde
  SIN_VERIFICAR o ACTIVO (D-12).
  - El incidente pasa a DESESTIMADO, se completa `fecha_cierre` y el índice queda en NULL.
  - Se audita `DESESTIMA_INCIDENTE` con la observación.
  - Después se controla la suspensión del autor (D-09), que puede auditarse como `SUSPENDE_CUENTA`.
- **Suspensión:**
  - en el ingreso, una cuenta SUSPENDIDA recibe el código `CUENTA_SUSPENDIDA` con un mensaje propio;
  - script `admin:rehabilitar-cuenta`, que la deja ACTIVA y audita `REHABILITA_CUENTA`.
- **Se elimina** la acción `resolve` del Sprint 2 (D-18).
- **Pantallas:**
  - **Vecino:** en un incidente activo, el botón "Informar que se resolvió" captura la posición y la foto,
    reutilizando los pasos del formulario de alta. El selector de foto lleva `capture="environment"` (D-22).
  - **Operador:** filtro "En revisión" con la miniatura de la evidencia, quién informó, cuándo y a qué distancia, y
    los botones Validar y Rechazar (este último pide la observación). En los incidentes sin verificar o activos,
    agregar Desestimar y Reclasificar.

## Pruebas mínimas esperadas (T13)

| Caso | Criterio |
|---|---|
| Un bache de severidad alta, con 5 puntos y 12 días activo, tiene IP = 83,00 | HU-04 / 1 |
| Una luminaria de severidad media, con 3 puntos y 2 días activa, tiene IP = 49,83 | HU-04 / 1 |
| Al llegar a 3 puntos se calcula el IP; una confirmación más lo recalcula | HU-04 / 1 |
| La tarea diaria recalcula después de mover `fecha_activacion` un día atrás | HU-04 / 1 |
| `GET /api/incidents` devuelve los activos ordenados por IP, con su banda | HU-04 / 2 |
| Solo los ACTIVO tienen IP; los demás quedan en NULL | HU-04 / 3 |
| El operador cambia la severidad: el IP se recalcula y se audita `CAMBIO_SEVERIDAD` | HU-04 / 4 |
| Un vecino no puede reclasificar (403) | Perfiles |
| Un vecino a 30 m con foto informa la resolución: EN_REVISION, con `informada_por` y `fecha_informe` | HU-05 / 1 |
| Un vecino a 80 m: 403 `FUERA_DE_RADIO` | HU-05 / 1 |
| Resolución sin foto: 400 | HU-05 / 1 |
| La evidencia usa la misma foto del reporte: 409 | D-11 |
| El operador valida: RESUELTO, con `fecha_cierre`, `validada_por` y `fecha_validacion` | HU-05 / 2 |
| El operador rechaza sin observación: 400; con observación: vuelve a ACTIVO, se recalcula el IP y la evidencia se conserva | HU-05 / 3 |
| El operador desestima con observación: DESESTIMADO y auditado | HU-05 / 4 |
| Al tercer desestimado en 30 días se suspende la cuenta, y el ingreso responde `CUENTA_SUSPENDIDA` | D-09 |
| Una foto con fecha EXIF de más de 24 h se rechaza; una con coordenadas EXIF a más de 50 m se rechaza | B-01 |
| Una solicitud de más de 1,5 MB: 413; un JPEG de 3000 px de lado: 400; un PNG: 400 | D-19 |
| La foto guardada y la miniatura no conservan metadatos EXIF y miden 1600 y 480 px como máximo | B-03 |
| Sin sesión no se puede leer una imagen; un vecino no puede ver la foto privada | B-03 |

Las 42 pruebas del Sprint 2 siguen pasando. Las que enviaban JSON al alta se adaptan a multipart con un JPEG de
1600 px generado en la prueba, distinto en cada caso, y su `hashOriginal`.

## Cierre (completar al terminar)

- **Fechas reales:** del __/__ al __/__.
- **Sprint Backlog final:** la tabla de arriba, con los estados y estimados reales.
- **Pruebas:** __ en total. Qué cubren: …
- **Decisiones aplicadas:** …
- **Pantallas para el documento:**
  - panel ordenado por prioridad;
  - mapa de calor ponderado;
  - informe de la resolución (vecino);
  - bandeja "En revisión" (operador);
  - rechazo con observación;
  - desestimación;
  - auditoría de un ciclo completo con resolución.
