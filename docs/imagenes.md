# Manejo de las imágenes (cerrado el 09/11/2026)

**Criterio:** se implementa lo que el documento ya dice sobre las imágenes, sin funciones nuevas. Hay un solo ajuste
(D-19): la foto se achica en el teléfono antes de subirla. No agrega nada a la interfaz y responde a un riesgo
concreto: llenar el servidor, la copia de respaldo y el plan de datos de los vecinos.

## Qué dice el documento (y se implementa tal cual)

- La foto se toma con la cámara en el momento del reporte. Hay una por reporte, y una por informe de resolución (HU-05).
- El sistema valida su tipo y tamaño y calcula la huella SHA-256 en el teléfono, según la arquitectura, para
  rechazar un archivo idéntico a otro ya registrado.
- Si la foto tiene EXIF: la fecha de captura no puede superar las 24 h, y sus coordenadas deben estar a menos de 50 m del dispositivo.
- Las imágenes se guardan en el almacenamiento de objetos. Se publica una **miniatura sin metadatos**; la imagen
  completa queda **privada** (la ve el operador para validar).
- Límite de 5 reportes por usuario cada 24 h. Las confirmaciones no llevan foto.

## El único ajuste (D-19): achicar la foto en el teléfono

- El documento dice que se guarda "el original". Un teléfono actual saca fotos de 3 a 8 MB. Guardarlas así consume
  los datos móviles del vecino al subirlas y llena el respaldo fuera del sitio (Google One de 100 GB): con 50 reportes
  por día, en alrededor de un año.
- **Cambio:** antes de subirla, el teléfono deja la foto en 1600 px como máximo, en JPEG y sin metadatos (≈ 0,4 MB).
  La huella y la lectura del EXIF se hacen sobre el original, antes de achicarlo.
- **Efecto:** sube unas 10 veces menos datos y ocupa unas 10 veces menos espacio (≈ 11,5 GB por año con 50 reportes
  diarios, en lugar de ≈ 108 GB).
- **Costo:** la huella y el EXIF del original los informa el teléfono. El documento ya reconoce que el EXIF puede
  faltar o estar modificado, y el control principal sigue siendo la confirmación presencial más la revisión del operador.
- **Cambio en el documento:** una oración de la arquitectura ("el original" pasa a ser "una versión reducida"), la
  descripción de `FotoRuta` en el diccionario y una línea en las limitaciones.

## Cómo se implementa (sin cambios visibles para el usuario)

**En el teléfono:**
1. Calcular la huella del original (como hoy).
2. Leer la fecha y las coordenadas EXIF con `exifr`.
3. Achicar la foto a 1600 px como máximo (JPEG con calidad 0,8, orientación corregida). Si el navegador lo permite,
   decodificarla directamente al tamaño reducido, para no agotar la memoria de un teléfono de gama baja.
4. Enviar la foto achicada junto con esos datos.

Cualquier formato que el navegador pueda abrir, incluido HEIC, sale como JPEG.

**En el servidor (validar tipo y tamaño):**
- Rechaza una solicitud de más de 1,5 MB.
- Rechaza una imagen que no sea JPEG o cuyo lado mayor no esté entre 800 y 1600 px.
- Aplica las reglas EXIF del documento.
- Con `sharp` guarda dos versiones, ambas sin metadatos:
  - `fotos/<hash>.jpg`, privada;
  - `miniaturas/<hash>.jpg`, de 480 px.
- Los PDF del operador (información oficial) tienen un máximo de 2 MB y no generan miniatura.

**Al mostrar:**
- El mapa no descarga fotos, solo los marcadores.
- La miniatura se carga cuando alguien abre un incidente.
- El operador ve la foto completa para validar.
- Las respuestas llevan una caché larga (`Cache-Control: private, max-age=604800, immutable`): como la clave es la
  huella, el contenido nunca cambia y no se vuelve a descargar.

## Qué se evaluó y se descartó por alcance

- **Modo "ahorrar datos":** el funcionamiento normal ya es el de menor consumo, así que un modo especial no agrega nada.
- **Borrado automático de imágenes por antigüedad:** queda como línea de trabajo futura.
- **Límite propio para los informes de resolución:** el circuito ya los limita. Solo se puede informar sobre un
  incidente activo, a menos de 50 m, y mientras está en revisión no admite otro informe.
- **Limitar el área del mapa:** no es necesario para lo que pide el documento.
