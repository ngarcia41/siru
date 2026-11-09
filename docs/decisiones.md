# Registro de decisiones y diferencias con el documento

Este registro sirve para dos cosas: mantener el código fiel al documento y saber qué hay que actualizar en el documento
cuando el código cambia. **Se actualiza en el mismo commit en que se toma o se aplica una decisión.**

## Tipos y estados

- **Tipos:**
  - **Cambio:** modifica algo que el documento define, como la base de datos, una regla o un valor. Requiere
    aprobación previa y una actualización del documento.
  - **Interpretación:** el documento no define el punto. Se propone una lectura, se aprueba y conviene sumar una oración al documento.
  - **Implementación:** es un detalle técnico que no contradice el documento; se registra para poder explicarlo en la defensa.
- **Estados:** Propuesta, Aprobada, Implementada o Reflejada en el documento.

Cada entrada lleva el mismo formato:

```
### D-NN · Título (Tipo · Estado · Sprint)
- Documento: qué dice y en qué sección.
- Decisión: qué se hace.
- Motivo: por qué.
- Alternativa descartada: cuál y por qué.
- Impacto en el documento: qué sección cambiar y cómo (o "ninguno").
```

## Decisiones ya tomadas (Sprints 1 y 2)

### D-01 · node-postgres en lugar de Prisma (Cambio · Reflejada en el documento · Sprint 2)
Las funciones de PostGIS (ST_DWithin, ST_Distance) se escriben directamente en SQL, y Prisma no maneja los tipos
geométricos de forma nativa. El documento ya lo explica al final del Sprint Backlog.

### D-02 · Tabla SESION y token de verificación guardado como hash (Cambio · Reflejada en el documento · Sprint 2)
Ambos figuran en el DER y en el diccionario de datos de la Entrega 4.

### D-03 · Descripción de 20 a 200 caracteres (Interpretación · Implementada · Sprint 2)
- Documento: solo fija el máximo, `Descripcion VARCHAR(200)`.
- Decisión: también se exige un mínimo de 20 caracteres, para evitar descripciones vacías como "bache".
- Impacto en el documento: agregar "entre 20 y 200 caracteres" en HU-02 o en el diccionario de datos.

### D-04 · Tipos y tamaños de imagen (Interpretación · Implementada en el Sprint 2 · se ajusta con D-19)
- Documento: dice que el sistema "valida su tipo y tamaño", sin dar valores.
- Sprint 2: el original debe ser JPEG, PNG o WebP de entre 50 KB y 10 MB, y se controla en el teléfono.
- Desde el Sprint 3 (D-19):
  - el teléfono sigue controlando el original: al menos 50 KB y cualquier formato que el navegador pueda abrir, incluido HEIC;
  - el servidor recibe siempre un JPEG reducido, de hasta 1,5 MB y con el lado mayor entre 800 y 1600 px.
- Impacto en el documento: nombrar los valores en "Controles sobre la imagen".

### D-05 · Variable para probar la precisión GPS desde la computadora (Implementación · Implementada · Sprint 2)
`NEXT_PUBLIC_PRECISION_GPS_MAXIMA` permite subir temporalmente el límite de 25 m para probar con la ubicación por IP.
En la demo y en producción vale 25. Impacto en el documento: ninguno.

## Decisiones para el Sprint 3 (aprobadas el 09/11/2026)

### D-06 · Detalles del índice de prioridad (Interpretación · Aprobada el 09/11/2026 · Sprint 3)
- **Componente T:** usa días enteros desde la activación, `LEAST(floor(días) / 30, 1)`. Así se reproducen exactamente
  los dos ejemplos del documento: IP = 83 e IP ≈ 50 (49,83).
- **Fuera de ACTIVO:** el IP queda en NULL. Si una resolución rechazada devuelve el incidente a ACTIVO, se recalcula.
- **Redondeo:** a 2 decimales en la base (NUMERIC(5,2)). En pantalla se muestra entero.
- Impacto en el documento: una oración en "Regla de priorización".

### D-07 · Programación de las tareas diarias (Implementación · Aprobada el 09/11/2026 · Sprint 3)
- Decisión: `scripts/tareas-diarias.ts` (`npm run tareas:diarias`) recalcula los IP a las 00:30, hora de Argentina.
  Es idempotente (se puede correr dos veces sin efecto adicional). En el servidor lo dispara cron; en desarrollo se
  corre a mano o con el Programador de tareas de Windows.
- Alternativa descartada: un temporizador dentro del proceso de Next.js, porque se duplica si hay más de una
  instancia y no se ejecuta si el proceso se reinicia justo a esa hora.
- Impacto en el documento: opcional, una oración en la descripción de la arquitectura.

### D-08 · Coordenadas de quienes confirman (Cambio de la base · **Aprobada: Opción A**, 09/11/2026 · se aplica en el Sprint 4)
- Documento: en "Privacidad", en el plan de R10 y en el Anexo 4 dice que las coordenadas de quienes confirman se
  conservan 90 días y luego se eliminan. El plan de R04 usa la velocidad entre acciones consecutivas. **El DER no tiene
  un campo para guardarlas, y el código del Sprint 2 no las guarda.**
- **Opción A (recomendada):** agregar a CONFIRMACION la columna `ubicacion GEOMETRY(Point, 4326) NULL`. La tarea
  diaria la pone en NULL a los 90 días y conserva `distancia_metros`. Hace falta una migración nueva y actualizar el
  DER y el diccionario.
- **Opción B:** no guardarlas y corregir el texto del documento en esos tres lugares. La heurística de velocidad solo
  podría comparar entre altas de incidentes.
- Descartado: guardarlas en AUDITORIA, porque es inmutable y no permitiría borrarlas a los 90 días.

### D-09 · Suspensión por reportes desestimados (Interpretación · Aprobada el 09/11/2026 · Sprint 3)
- Documento: el plan de R02 suspende las cuentas con 3 reportes desestimados en 30 días, y EstadoCuenta incluye
  SUSPENDIDA. No dice cuánto dura la suspensión ni cómo termina.
- Decisión:
  - Al desestimar, se cuentan los incidentes del autor en estado DESESTIMADO con `fecha_cierre` en los últimos 30 días.
    Con 3 o más, la cuenta pasa a SUSPENDIDA, se cierran sus sesiones y se audita `SUSPENDE_CUENTA`.
  - Al intentar ingresar, recibe un mensaje propio (no el de bloqueo).
  - La suspensión dura hasta que el administrador técnico la levanta con `npm run admin:rehabilitar-cuenta`, a pedido
    de la sociedad de fomento. La acción se audita.
- Alternativa descartada: una suspensión de duración fija, por ejemplo 30 días, porque necesitaría guardar una fecha
  de fin de la suspensión, y el DER no tiene ese campo. La rehabilitación por el administrador no cambia la base.
- Impacto en el documento: una oración en "Controles sobre la ubicación, la frecuencia y el uso".

### D-10 · Quién informa y quién valida la resolución (Interpretación · Aprobada el 09/11/2026 · Sprint 3)
- **Vecino:** solo sobre un incidente ACTIVO, a menos de 50 m, con precisión de 25 m o menos y foto.
- **Operador:** carga la "información oficial" con evidencia (foto o PDF), sin control de distancia, según la tabla de estados y la de perfiles.
- **Validación:** el documento no exige que valide un operador distinto del que informó. Con un solo operador en la
  demo, puede validar lo que él mismo informó, y la auditoría deja constancia de ambos pasos.
- Alternativa descartada: exigir un operador distinto para validar (separación de funciones). Se reconoce como una
  limitación de la demo, que tiene un solo operador, y se presenta así en la defensa.
- Impacto en el documento: una línea en las limitaciones.

### D-11 · Unicidad de la evidencia (Implementación · Aprobada el 09/11/2026 · Sprint 3)
La evidencia no puede repetir el hash de ninguna imagen ya registrada, ni de un incidente ni de otra resolución.
Esto aplica la regla del documento de "rechazar la carga de un archivo idéntico a otro ya registrado" e impide usar la
foto original del problema como prueba de que se arregló.

### D-12 · Desde qué estados se desestima (Interpretación · Aprobada el 09/11/2026 · Sprint 3)
Se puede desestimar un incidente en SIN_VERIFICAR o ACTIVO. Uno EN_REVISION primero se valida o se rechaza.
La observación es obligatoria y se guarda en el detalle de la auditoría. `fecha_cierre` se completa también al desestimar.

### D-13 · Reclasificar la categoría (Interpretación · Aprobada el 09/11/2026 · Sprint 3)
La tabla de perfiles permite al operador reclasificar la categoría y la severidad. Si con la nueva categoría queda
un incidente abierto de esa categoría a menos de 50 m, se rechaza con 409 y se muestra el existente, para que el
operador desestime el duplicado. El cambio de categoría no recalcula el IP; el de severidad sí.

### D-14 · Almacenamiento de imágenes (Implementación · Aprobada el 09/11/2026 · Sprint 3)
- Se define una interfaz de almacenamiento con dos implementaciones:
  - local, para desarrollo, en `almacenamiento/`, fuera de `public/` y de git;
  - Spaces, compatible con S3, para producción. Se implementa en el Sprint 4.
- Claves por hash:
  - `fotos/<hash>.jpg` (hasta 1600 px, privada), guardada en `foto_ruta` o `evidencia_ruta`;
  - `miniaturas/<hash>.jpg` (hasta 480 px), que se deriva por convención, sin columna nueva;
  - `documentos/<hash>.pdf`.
- Las imágenes se sirven por una ruta autenticada:
  - las miniaturas, para cualquier usuario autenticado;
  - la foto privada, solo para el operador. Esto coincide con el documento: "se publica una miniatura".
- Detalle completo en `imagenes.md`.

### D-15 · Dependencias nuevas (Implementación · Aprobada el 09/11/2026 · Sprint 3)
- `sharp`, en el servidor: decodifica y recodifica la imagen, quita los metadatos y genera la miniatura.
- `exifr`, en el navegador: lee la fecha y las coordenadas EXIF del original antes de reducirlo.
- Impacto en el documento: agregarlas a la tabla "Herramientas de desarrollo", con su referencia APA.

### D-16 · Fecha EXIF sin zona horaria (Interpretación · Aprobada el 09/11/2026 · Sprint 3)
Si la foto no informa su desfase horario, la fecha de captura se interpreta en la hora de Argentina (UTC−3).

### D-17 · Pruebas sobre una base aislada (Implementación · Aprobada el 09/11/2026 · Sprint 3)
`npm run prueba` recrea `siru_prueba`, levanta el servidor contra esa base, corre las pruebas y lo apaga. Se niega a
correr si la base de destino no es `siru_prueba`. Impacto en el documento: ninguno.

### D-18 · Fin del cierre directo del Sprint 2 (Implementación · Aprobada el 09/11/2026 · Sprint 3)
La acción `resolve` del Sprint 2, en la que el operador cierra sin evidencia, se reemplaza por el circuito de HU-05.
Las dos pruebas del cierre se adaptan al nuevo circuito sin perder lo que verifican: quién validó y cuándo.

## Imágenes (09/11/2026; detalle en `imagenes.md`)

### D-19 · Achicar la foto en el teléfono (Cambio · Aprobada el 09/11/2026 · Sprint 3)
- Documento: en la arquitectura dice "el original queda privado y se publica una miniatura sin metadatos", y en el
  diccionario `FotoRuta` es la "ruta de la imagen original".
- Decisión:
  - el teléfono achica la foto a 1600 px como máximo (JPEG, sin metadatos) antes de subirla;
  - la huella SHA-256 y el EXIF se obtienen del original en el teléfono, que ya calculaba la huella según la arquitectura;
  - el servidor guarda esa versión (privada) y una miniatura de 480 px.
- Motivo: consumo de datos de los vecinos (≈ 0,4 MB por foto en lugar de 3 a 8 MB), memoria de los teléfonos de
  gama baja y capacidad del almacenamiento y de la copia fuera del sitio de 100 GB.
- Alternativa descartada: guardar el original. Con 50 reportes por día llenaría la copia fuera del sitio en alrededor de un año.
- Consecuencia: la huella y el EXIF del original los informa el teléfono. Se suma a las limitaciones, que ya
  reconocen que el EXIF puede faltar o estar modificado.
- Impacto en el documento: una oración en la arquitectura, la descripción de `FotoRuta` y una línea en las limitaciones.
- **Descartado por alcance**, para no agregar funciones que no están en el documento:
  - el modo "ahorrar datos", porque el funcionamiento normal ya es el de menor consumo;
  - el borrado de imágenes por antigüedad, que queda como trabajo futuro;
  - un límite propio para los informes de resolución, porque el circuito ya los limita;
  - limitar el área del mapa.

### D-20 · Versiones del código con etiquetas de git (Implementación · Aprobada el 09/11/2026 · desde el Sprint 2)
- Documento: dice que el código se versiona en GitHub y que se hacen copias manuales de los hitos.
- Decisión: una sola carpeta de trabajo (`D:\Desarrollo\siru-tfg`). Cada hito se marca con una etiqueta según el
  versionado semántico (Preston-Werner, s.f.):

  | Etiqueta | Hito |
  |---|---|
  | `v0.1.0` | Sprint 1: la versión original de `D:\Desarrollo\siru` |
  | `v0.2.0` | Sprint 2 |
  | `v0.3.0` | Sprint 3 |
  | `v0.4.0` | Sprint 4 |
  | `v1.0.0` | La versión que se entrega y se defiende |

  La versión mayor 0 indica desarrollo inicial. La copia de cada hito es `siru-vX.Y.Z.zip` en Google Drive.
- Alternativa descartada: una carpeta por versión (`siru_v3`, etc.), porque duplica el código y es justamente lo que reemplaza git.
- Impacto en el documento: una oración en "Respaldo › Código fuente" y la referencia
  "Preston-Werner, T. (s.f.). *Versionado semántico 2.0.0*. https://semver.org/lang/es/".

## Brechas entre el documento y el código

Son puntos que el documento describe como parte del sistema y que el código todavía no hace. Cada una se cierra de
una de dos formas, y las dos son válidas: implementándola o corrigiendo el texto del documento. En ambos casos se
registra la decisión.

| ID | Qué dice el documento (sección) | Estado en el código | Plan |
|---|---|---|---|
| B-01 | Verificar la fecha EXIF (24 h como máximo) y las coordenadas EXIF (menos de 50 m) (Reglas › imagen) | `exif.ts` lo simula; `fecha_captura_foto` queda NULL | Sprint 3, T03 |
| B-02 | Las imágenes se guardan en el almacenamiento de objetos (Arquitectura) | El servidor nunca recibe la imagen; solo guarda la huella | Sprint 3, T02 (con D-19) |
| B-03 | Imagen privada, miniatura sin metadatos y recodificación en el servidor (Arquitectura, Seguridad, Privacidad) | No se guarda la imagen | Sprint 3, T04 (con D-19) |
| B-04 | Posición con 2 minutos de antigüedad como máximo y velocidad de 150 km/h como máximo (Reglas › ubicación, R04) | No implementado | Sprint 4 (con D-08) |
| B-05 | Coordenadas de confirmación por 90 días (Privacidad, R10, Anexo 4) | No se guardan | Sprint 4 (D-08) |
| B-06 | El vecino restablece su contraseña por correo tras 3 bloqueos en 24 h (Seguridad › Bloqueo) | Solo hay blanqueo por el administrador | Sprint 4 (requiere B-07) |
| B-07 | Enlace de verificación enviado al correo (Seguridad › Usuarios) | `MODO_CORREO=consola` | Sprint 4, antes de validar con vecinos |
| B-08 | Aviso 7 días antes del vencimiento de la contraseña (Seguridad › Claves) | El vencimiento se aplica; el aviso no | Sprint 4 |
| B-09 | Pedir consentimiento informado (R10, Anexo 4) | No hay consentimiento en el registro | Sprint 4 |
| B-10 | El operador puede ocultar imágenes con rostros o patentes (R10) | No implementado | Sprint 4 (proponer cómo hacerlo sin cambiar la base) |
| B-11 | El vecino puede modificar y dar de baja sus datos de cuenta (Seguridad › Perfiles) | No implementado; la baja choca con la auditoría inmutable | Sprint 4: decidir si se implementa o se corrige el texto |
| B-12 | El proxy inverso limita las solicitudes por IP (Arquitectura) | Corresponde al despliegue | Sprint 4 |
| B-13 | Respaldo completo semanal e incremental diario con pg_basebackup (Seguridad › Respaldo) | Corresponde al despliegue | Sprint 4 |
