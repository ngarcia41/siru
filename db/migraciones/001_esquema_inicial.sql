-- =====================================================================
-- SIRU — Migración 001: esquema inicial en PostgreSQL con PostGIS
-- Implementa el DER del documento (Entrega 3) más la tabla SESION,
-- necesaria para invalidar la sesión en el servidor.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------
-- Tablas de referencia
-- ---------------------------------------------------------------------
CREATE TABLE categoria (
  categoria_id  SMALLINT     PRIMARY KEY,
  nombre        VARCHAR(30)  NOT NULL UNIQUE
);

CREATE TABLE severidad (
  severidad_id  SMALLINT     PRIMARY KEY,
  nombre        VARCHAR(10)  NOT NULL UNIQUE,
  peso          NUMERIC(3,2) NOT NULL CHECK (peso > 0 AND peso <= 1),
  criterio      VARCHAR(200) NOT NULL
);

INSERT INTO categoria (categoria_id, nombre) VALUES
  (1, 'Bache'),
  (2, 'Luminaria'),
  (3, 'Anegamiento'),
  (4, 'Basura acumulada'),
  (5, 'Otro');

INSERT INTO severidad (severidad_id, nombre, peso, criterio) VALUES
  (1, 'baja',  0.33, 'Deterioro menor que no afecta la circulación.'),
  (2, 'media', 0.67, 'Afecta la circulación o la seguridad sin riesgo inmediato.'),
  (3, 'alta',  1.00, 'Riesgo inmediato para personas o vehículos.');

-- ---------------------------------------------------------------------
-- Usuarios, contraseñas y sesiones
-- ---------------------------------------------------------------------
CREATE TABLE usuario (
  usuario_id               SERIAL       PRIMARY KEY,
  email                    VARCHAR(120) NOT NULL UNIQUE,
  hash_contrasena          VARCHAR(60)  NOT NULL,
  rol                      VARCHAR(10)  NOT NULL CHECK (rol IN ('VECINO', 'OPERADOR')),
  estado_cuenta            VARCHAR(12)  NOT NULL DEFAULT 'PENDIENTE'
                           CHECK (estado_cuenta IN ('PENDIENTE', 'ACTIVA', 'BLOQUEADA', 'SUSPENDIDA')),
  intentos_fallidos        SMALLINT     NOT NULL DEFAULT 0,
  bloqueado_hasta          TIMESTAMPTZ,
  debe_cambiar_clave       BOOLEAN      NOT NULL DEFAULT FALSE,
  fecha_cambio_clave       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ultimo_acceso            TIMESTAMPTZ,
  fecha_registro           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Verificación de correo: se guarda solo la huella SHA-256 del enlace
  token_verificacion_hash  CHAR(64),
  token_verificacion_vence TIMESTAMPTZ
);

CREATE TABLE historial_contrasena (
  historial_id     SERIAL      PRIMARY KEY,
  usuario_id       INT         NOT NULL REFERENCES usuario(usuario_id) ON DELETE CASCADE,
  hash_contrasena  VARCHAR(60) NOT NULL,
  fecha_alta       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX historial_contrasena_usuario_idx ON historial_contrasena (usuario_id, fecha_alta DESC);

CREATE TABLE sesion (
  sesion_id         UUID        PRIMARY KEY,
  usuario_id        INT         NOT NULL REFERENCES usuario(usuario_id) ON DELETE CASCADE,
  creada            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultima_actividad  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revocada_en       TIMESTAMPTZ,
  direccion_ip      VARCHAR(45)
);
CREATE INDEX sesion_usuario_idx ON sesion (usuario_id);

-- ---------------------------------------------------------------------
-- Incidentes y confirmaciones
-- ---------------------------------------------------------------------
CREATE TABLE incidente (
  incidente_id        SERIAL        PRIMARY KEY,
  usuario_id          INT           NOT NULL REFERENCES usuario(usuario_id),
  categoria_id        SMALLINT      NOT NULL REFERENCES categoria(categoria_id),
  severidad_id        SMALLINT      NOT NULL REFERENCES severidad(severidad_id),
  descripcion         VARCHAR(200)  NOT NULL,
  ubicacion           GEOMETRY(Point, 4326) NOT NULL,
  precision_gps       NUMERIC(6,1),
  foto_ruta           VARCHAR(255),
  hash_foto           CHAR(64)      NOT NULL UNIQUE,
  fecha_captura_foto  TIMESTAMPTZ,
  puntaje_confianza   SMALLINT      NOT NULL DEFAULT 1 CHECK (puntaje_confianza >= 0),
  estado              VARCHAR(15)   NOT NULL DEFAULT 'SIN_VERIFICAR'
                      CHECK (estado IN ('SIN_VERIFICAR', 'ACTIVO', 'EN_REVISION', 'RESUELTO', 'DESESTIMADO')),
  indice_prioridad    NUMERIC(5,2),
  fecha_creacion      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  fecha_activacion    TIMESTAMPTZ,
  fecha_cierre        TIMESTAMPTZ
);
-- Índices espaciales GiST: sobre la geometría (consultas por zona del mapa) y
-- sobre su versión geography, que usa ST_DWithin para medir en metros
-- al detectar duplicados y validar confirmaciones.
CREATE INDEX incidente_ubicacion_gist ON incidente USING GIST (ubicacion);
CREATE INDEX incidente_ubicacion_geog_gist ON incidente USING GIST ((ubicacion::geography));
CREATE INDEX incidente_estado_idx ON incidente (estado);
CREATE INDEX incidente_usuario_fecha_idx ON incidente (usuario_id, fecha_creacion);

CREATE TABLE confirmacion (
  confirmacion_id     SERIAL       PRIMARY KEY,
  incidente_id        INT          NOT NULL REFERENCES incidente(incidente_id),
  usuario_id          INT          NOT NULL REFERENCES usuario(usuario_id),
  distancia_metros    NUMERIC(6,1) NOT NULL CHECK (distancia_metros < 50),
  precision_gps       NUMERIC(6,1),
  fecha_confirmacion  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Un usuario no puede confirmar dos veces el mismo incidente
  CONSTRAINT confirmacion_unica UNIQUE (incidente_id, usuario_id)
);
CREATE INDEX confirmacion_usuario_fecha_idx ON confirmacion (usuario_id, fecha_confirmacion);

CREATE TABLE resolucion (
  resolucion_id     SERIAL       PRIMARY KEY,
  incidente_id      INT          NOT NULL REFERENCES incidente(incidente_id),
  informada_por     INT          NOT NULL REFERENCES usuario(usuario_id),
  fecha_informe     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  evidencia_ruta    VARCHAR(255),
  hash_evidencia    CHAR(64),
  observacion       VARCHAR(300),
  validada_por      INT          REFERENCES usuario(usuario_id),
  fecha_validacion  TIMESTAMPTZ,
  resultado         VARCHAR(10)  NOT NULL DEFAULT 'PENDIENTE'
                    CHECK (resultado IN ('PENDIENTE', 'CONFIRMADA', 'RECHAZADA'))
);

-- ---------------------------------------------------------------------
-- Auditoría (solo inserción)
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
  auditoria_id  BIGSERIAL    PRIMARY KEY,
  usuario_id    INT          REFERENCES usuario(usuario_id),
  incidente_id  INT          REFERENCES incidente(incidente_id),
  accion        VARCHAR(40)  NOT NULL,
  detalle       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  direccion_ip  VARCHAR(45),
  fecha_hora    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_incidente_idx ON auditoria (incidente_id, fecha_hora);
CREATE INDEX auditoria_usuario_idx ON auditoria (usuario_id, fecha_hora);
CREATE INDEX auditoria_accion_idx ON auditoria (accion, fecha_hora);

-- La base de datos rechaza cualquier modificación o borrado de la auditoría,
-- aunque provenga de una consulta escrita a mano.
CREATE FUNCTION auditoria_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría no puede modificarse ni eliminarse';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auditoria_sin_cambios
  BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_inmutable();

CREATE TRIGGER auditoria_sin_vaciado
  BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_inmutable();
