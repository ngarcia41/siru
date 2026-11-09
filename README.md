# SIRU — Sistema Interactivo de Reportes Urbanos (Sprint 2)

Plataforma de reportes urbanos geolocalizados para Ramos Mejía, hecha con
Next.js 14, Leaflet y PostgreSQL con PostGIS.

Esta versión completa el Sprint 2:

- **Base de datos real.** PostgreSQL con PostGIS reemplaza los datos simulados en memoria. Los duplicados y las confirmaciones se validan con `ST_DWithin` y `ST_Distance`, usando un índice espacial GiST.
- **Registro e inicio de sesión (HU-01).**
  - Correo verificado.
  - Política de claves.
  - Contraseñas guardadas con bcrypt, costo 12.
- **Sesión y bloqueo (HU-08).**
  - Bloqueo de 15 minutos después de 3 intentos fallidos. Si una cuenta se bloquea 3 veces en 24 horas, queda bloqueada hasta que el administrador blanquee la clave.
  - La sesión expira tras 30 minutos sin actividad para el vecino y 15 para el operador, con una duración máxima de 8 horas.
  - Historial de las últimas 3 claves.
  - Cambio de clave obligatorio en el primer ingreso del operador.
- **Auditoría (HU-07).**
  - Se registran todas las acciones críticas con usuario, incidente, detalle, dirección IP, fecha y hora.
  - La base de datos rechaza modificar o borrar esos registros.
- **Permisos por perfil.** El vecino reporta y confirma. El operador registra el cierre y consulta la auditoría.
- **Ajustes de HU-02.**
  - Puntaje inicial de 1 punto.
  - Precisión GPS de 25 m o menos.
  - Máximo de 5 reportes por día.
  - Categorías del documento: Bache, Luminaria, Anegamiento, Basura acumulada y Otro.

---

## 1. Instalar PostgreSQL y PostGIS (una sola vez)

1. Descargá el instalador de **PostgreSQL 17** para Windows desde
   <https://www.postgresql.org/download/windows/> (enlace "Download the installer").
2. Durante la instalación:
   - Elegí una contraseña para el usuario **postgres** y anotala.
   - Dejá el puerto **5432**.
   - Al final, dejá marcada la opción **Stack Builder**.
3. En Stack Builder:
   1. Elegí tu servidor PostgreSQL 17.
   2. En **Spatial Extensions**, marcá **PostGIS** y seguí el asistente con las opciones por defecto.
   3. Cuando ofrezca crear una base de ejemplo, no hace falta.

## 2. Configurar el proyecto

En una terminal (PowerShell), dentro de esta carpeta:

```powershell
copy .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Abrí `.env` y completá estos dos valores:

- **`DATABASE_URL`:** reemplazá `TU_CONTRASEÑA` por la contraseña del usuario postgres.
- **`SESION_SECRETO`:** pegá el valor que imprimió el comando anterior.

Después, instalá las dependencias y creá la base:

```powershell
npm install
npm run db:migrar     # crea la base "siru", activa PostGIS y crea las tablas
npm run db:semilla    # carga los datos de demostración (solo sobre una base vacía)
npm run dev
```

Abrí <http://localhost:3000>.

## 3. Usuarios de prueba

Solo para el entorno local. No usar fuera de la demo.

| Perfil   | Correo                                  | Contraseña       |
|----------|-----------------------------------------|------------------|
| Vecino   | vecino1@siru.local … vecino4@siru.local | `Ramos#Mejia26`  |
| Operador | operador@siru.local                     | `Fomento#Temp26` (temporal: el sistema pide cambiarla al ingresar) |

Para registrar un vecino nuevo no hace falta un servidor de correo. Con
`MODO_CORREO=consola`, el enlace de verificación aparece en la pantalla de
registro y en la terminal donde corre `npm run dev`.

## 4. Probar el alta de incidentes desde la computadora

El documento exige una precisión GPS de **25 m o menos**. En una computadora
el navegador estima la ubicación por la IP, con cientos o miles de metros de
error, así que el sistema va a pedir que repitas la captura. Hay dos formas de
probarlo:

- **Desde la computadora:** subí temporalmente `NEXT_PUBLIC_PRECISION_GPS_MAXIMA=5000` en `.env` y reiniciá `npm run dev`. Antes de la demo, volvé a `25`.
- **Desde el celular:** el navegador solo entrega la ubicación en una conexión segura (HTTPS), así que hace falta publicar el sistema con un certificado. Queda para la etapa de validación.

## 5. Tareas del administrador técnico

```powershell
npm run admin:crear-operador -- referente@fomento.org   # crea un operador con clave temporal
npm run admin:blanquear-clave -- vecino@correo.com      # blanquea una clave y desbloquea la cuenta
```

Cada script muestra la clave temporal una sola vez. Entregala por un canal
seguro.

## 6. Pruebas funcionales

`pruebas/api.prueba.ts` recorre 42 casos de las historias del Sprint 2:
registro, verificación, bloqueo, inactividad, duplicados, confirmaciones,
permisos y auditoría.

**Las pruebas crean datos.** Corrélas solo sobre una base de prueba:

1. En `.env`, cambiá temporalmente el final de `DATABASE_URL` de `/siru` a `/siru_prueba`.
2. Corré estos comandos:

   ```powershell
   npm run db:migrar
   npm run db:semilla
   npm run build
   npm start
   # en otra terminal:
   npx tsx pruebas/api.prueba.ts http://localhost:3000
   ```

3. Volvé a dejar `DATABASE_URL` como estaba.

## 7. Control de versiones (recomendado)

Git ya está instalado en tu computadora. Para empezar a versionar esta carpeta:

```powershell
git init
git add .
git commit -m "Sprint 2: PostgreSQL con PostGIS, autenticación, sesión y auditoría"
```

El archivo `.env` queda fuera del repositorio porque está en `.gitignore`.

## Estructura

| Carpeta | Contenido |
|---|---|
| `db/migraciones/` | Esquema SQL: tablas del DER, índices GiST y disparador de la auditoría |
| `scripts/` | Migración, datos de demostración y tareas del administrador |
| `src/lib/servidor/` | Acceso a la base, sesión, contraseñas, auditoría e incidentes (solo servidor) |
| `src/lib/reglas.ts` | Parámetros de las reglas del documento (50 m, 3 puntos, 25 m, límites, tiempos) |
| `src/app/api/` | Rutas de la API |
| `src/app/ingresar`, `registro`, `cambiar-clave`, `auditoria` | Pantallas nuevas |
| `pruebas/` | Pruebas funcionales de la API |

## Pendiente para el Sprint 3

- HU-04: índice de prioridad y mapa de calor ponderado.
- HU-05: el vecino informa la resolución con evidencia fotográfica y el operador la valida o la rechaza. Desestimar reportes.
- Guardar la imagen del reporte (hoy se valida y se guarda su huella SHA-256).
- Envío real del correo de verificación por SMTP.
