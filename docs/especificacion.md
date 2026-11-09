# Especificación funcional (resumen fiel de la Entrega 4)

Este archivo resume las reglas del documento con sus mismos valores. Si algo de acá parece contradecir el documento,
manda el documento y este resumen se corrige.

## Objetivo y límites

- **Objetivo del sistema:** registrar, validar espacialmente, priorizar y cerrar con evidencia los incidentes de
  infraestructura urbana que reportan los vecinos de Ramos Mejía, y consolidarlos en un mapa de calor y en informes de zonas críticas.
- **Límites:** desde que el vecino detecta un incidente y lo registra con su posición GPS y una foto, hasta que un
  operador valida la resolución informada y el incidente queda cerrado, con su evidencia, en el historial.
- **Categorías:** Bache, Luminaria, Anegamiento, Basura acumulada y Otro.

## Requerimientos funcionales y su trazabilidad

| RF | El sistema deberá permitir… | HU | Sprint |
|---|---|---|---|
| RF01 | Registrar vecinos con correo verificado y autenticar a vecinos y operadores | HU-01 | 2 |
| RF02 | Gestionar la sesión, bloquear la cuenta ante intentos fallidos y administrar el cambio de contraseña | HU-08 | 2 |
| RF03 | Registrar incidentes georreferenciados con fotografía, categoría y severidad | HU-02 | 1 |
| RF04 | Rechazar duplicados por proximidad de 50 m y por huella digital de la imagen | HU-02 | 1 |
| RF05 | Confirmar incidentes en el lugar y acumular puntos de confianza | HU-03 | 1 |
| RF06 | Calcular el índice de prioridad y representar los incidentes activos en un mapa de calor | HU-04 | **3** |
| RF07 | Informar y validar resoluciones con evidencia, y desestimar reportes falsos | HU-05 | **3** |
| RF08 | Emitir el informe de zonas críticas | HU-06 | 4 |
| RF09 | Registrar y consultar la auditoría de las acciones críticas | HU-07 | 2 |

## Perfiles y permisos

| Función | Vecino | Operador |
|---|---|---|
| Consultar el mapa, el mapa de calor y el panel de incidentes | Consulta | Consulta |
| Registrar un incidente | Alta | No |
| Confirmar un incidente (a menos de 50 m) | Alta | No |
| Informar la resolución de un incidente con evidencia | Alta (a menos de 50 m) | Alta |
| Validar o rechazar una resolución | No | Modificación |
| Reclasificar la categoría o la severidad | No | Modificación |
| Desestimar un reporte falso | No | Modificación |
| Emitir el informe de zonas críticas | No | Alta |
| Consultar la auditoría | No | Consulta |
| Modificar o eliminar registros de auditoría | No | No |
| Editar o eliminar sus propios datos de cuenta | Modificación y baja | Modificación |

- **Operadores:** no se registran desde la aplicación. El administrador técnico crea su cuenta con una clave temporal,
  y en el primer ingreso el sistema exige cambiarla.
- **Administrador técnico:** no es un perfil de la aplicación. Administra el servidor y la base, no puede ver las
  claves y solo puede blanquearlas.

## Ciclo de vida del incidente

| Estado | Condición de ingreso | Responsable |
|---|---|---|
| Sin verificar | Reporte válido con 1 o 2 puntos de confianza | Vecino que reporta |
| Activo | Alcanza 3 puntos; se calcula el índice de prioridad | Sistema (automático) |
| En revisión | Un vecino a menos de 50 m y con foto informa que se resolvió, o el operador carga la información oficial | Vecino u operador |
| Resuelto | El operador valida la evidencia; se registran quién informó, quién validó, las fechas y la evidencia | Operador |
| Desestimado | El operador determina que el reporte es falso, inexistente o ajeno al alcance, con observación obligatoria | Operador |

Si el operador rechaza la resolución, el incidente vuelve a Activo y la evidencia rechazada queda registrada con su observación.

## Reglas de validación y confianza

| Parámetro | Valor inicial | Constante en `reglas.ts` |
|---|---|---|
| Radio único de duplicados y de presencia (confirmar e informar la resolución) | 50 m | `RADIO_METROS` |
| Precisión GPS máxima | 25 m | `PRECISION_GPS_MAXIMA` |
| Umbral de confianza | 3 puntos (1 del reportante más 2 confirmaciones) | `UMBRAL_ACTIVACION` |
| Pesos del índice de prioridad | 0,5 / 0,3 / 0,2 | por crear en el Sprint 3 |
| Límites cada 24 horas por usuario | 5 reportes y 20 confirmaciones | `LIMITE_REPORTES_24H`, `LIMITE_CONFIRMACIONES_24H` |

Los parámetros son configurables, y sus valores son iniciales: se revisan con los resultados de la validación.

- **Duplicado:** no se admite un reporte de la misma categoría a menos de 50 m de un incidente no cerrado
  (Sin verificar, Activo o En revisión). El sistema propone confirmar el incidente existente.
- **Confirmación:** debe venir de una cuenta distinta de la del autor, una sola vez por cuenta, a menos de 50 m. Suma 1 punto.
- **Imagen** (desde el Sprint 3, ver `imagenes.md` y D-19):
  - se toma con la cámara en el momento del reporte;
  - se valida su tipo y tamaño;
  - el SHA-256 rechaza un archivo idéntico a otro ya registrado;
  - si la foto tiene EXIF, la fecha de captura no puede superar las 24 h y sus coordenadas deben estar a menos de 50 m del dispositivo.
  - Límites reconocidos: el hash solo detecta copias idénticas byte a byte, y el EXIF puede faltar o estar modificado.
    Como mejora futura queda el hash perceptual.
- **Ubicación (heurísticas):** se rechaza una posición con precisión mayor a 25 m o con más de 2 minutos de antigüedad,
  y un desplazamiento entre acciones consecutivas que implique más de 150 km/h. Además, se compara la posición con el EXIF.
- **Uso:**
  - para reportar o confirmar hace falta una cuenta con el correo verificado;
  - nadie puede confirmar su propio reporte;
  - se suspenden las cuentas con 3 reportes desestimados en 30 días (plan de R02).
- **Privacidad (Ley 25.326):**
  - se guardan solo los datos necesarios;
  - la imagen que se publica es una copia sin metadatos;
  - el mapa muestra la ubicación del incidente y no la del usuario;
  - las coordenadas de quienes confirman se conservan 90 días y luego se eliminan, conservando la distancia;
  - el operador puede ocultar imágenes con rostros o patentes (plan de R10).

## Índice de prioridad (HU-04)

**IP = 100 × (0,5 × S + 0,3 × C + 0,2 × T)**, solo para incidentes en estado Activo. Se recalcula con cada
confirmación y todos los días a las 00:30.

| Componente | Cálculo |
|---|---|
| S, severidad (peso 0,5) | Campo `peso` de SEVERIDAD: baja 0,33; media 0,67; alta 1,00 |
| C, respaldo comunitario (peso 0,3) | `min(puntos / 6, 1)`; un incidente recién activado (3 puntos) aporta 0,5 |
| T, tiempo sin resolver (peso 0,2) | `min(días desde la activación / 30, 1)` |

- **Bandas:** alta si IP ≥ 70; media si 40 ≤ IP < 70; baja si IP < 40.
- **Ejemplos del documento** (deben pasar como pruebas):
  - un bache de severidad alta, con 5 puntos y 12 días activo, tiene IP = 83;
  - una luminaria de severidad media, con 3 puntos y 2 días activa, tiene IP ≈ 50.
- **Mapa de calor:** cada incidente activo se pondera por su IP.
- **Reclasificación:** la severidad la propone el vecino, y el operador la puede cambiar. Cada cambio se audita.
- **Criterios de severidad:**
  - **Alta:** riesgo inmediato para personas o vehículos.
  - **Media:** afecta la circulación o la seguridad sin riesgo inmediato.
  - **Baja:** deterioro menor.

## Seguridad (implementada en el Sprint 2; mantenerla)

- **Claves:**
  - Al menos 8 caracteres, con mayúscula, minúscula, número y carácter especial.
  - No se admiten espacios, secuencias, repeticiones, patrones de teclado ni el propio correo.
  - Se guarda el hash bcrypt con costo 12; nunca se cifran de forma reversible.
  - Vencen a los 90 días para los operadores y a los 180 para los vecinos, con un aviso 7 días antes.
  - No se puede repetir ninguna de las últimas 3.
- **Bloqueo:**
  - 3 intentos fallidos consecutivos bloquean la cuenta 15 minutos.
  - 3 bloqueos en 24 h la dejan BLOQUEADA hasta que el vecino restablezca su contraseña por correo, o, si es un
    operador, hasta que el administrador la blanquee.
  - El mensaje de error es siempre genérico.
- **Sesión:**
  - JWT firmado en una cookie HttpOnly, Secure y SameSite=Strict.
  - Expira tras 30 minutos de inactividad para el vecino y 15 para el operador, con un aviso 2 minutos antes.
  - Dura como máximo 8 horas y se invalida en el servidor al salir.
- **Acciones críticas auditadas:** alta, confirmación, cambio de severidad, informe y validación de la resolución,
  desestimación, inicio de sesión fallido y bloqueo. Cada registro guarda usuario, fecha y hora, IP y detalle, y es inmodificable.

## Arquitectura (Opción B, adoptada)

- **Cliente:** navegador del teléfono o de la computadora. Toma la posición con la Geolocation API, la foto con la
  cámara, calcula el hash y muestra el mapa Leaflet con OpenStreetMap y la capa de calor.
- **Comunicación:** todo viaja por HTTPS. Un proxy inverso termina la conexión TLS y limita las solicitudes por IP.
- **API REST:** Route Handlers de Next.js sobre Node.js, en seis módulos: autenticación y sesiones, validación de
  reportes, confianza y priorización, resoluciones, analítica y auditoría.
- **Datos:** PostgreSQL con PostGIS, mediante node-postgres con SQL parametrizado.
- **Imágenes:** se guardan en Spaces. El original queda privado y se publica una miniatura sin metadatos.
  Con D-19, si se aprueba, se guarda una versión reducida en lugar del original.
- **Despliegue:** contenedores Docker en un servidor virtual en la nube. Respaldo 3-2-1 y código en un repositorio privado de GitHub.
