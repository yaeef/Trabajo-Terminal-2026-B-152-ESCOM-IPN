-- db/init/001_init_schema.sql
--
-- Única definición del esquema de la base de datos (no hay migraciones,
-- ver db/init/README.md).
--
-- MariaDB lo ejecuta UNA SOLA VEZ, al crear el volumen de datos por primera
-- vez (/docker-entrypoint-initdb.d). La suite de pruebas también lo usa para
-- crear su BD (backend/tests/esquema.py).
--
-- Orden de creación: cada tabla va después de las tablas a las que apunta.


-- ==========================================================================
-- Identidad: usuarios, propietarios y tokens
-- ==========================================================================

CREATE TABLE usuario (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    materno VARCHAR(100),
    paterno VARCHAR(100),
    correo VARCHAR(100) UNIQUE NOT NULL,
    correo_verificado BOOLEAN NOT NULL DEFAULT FALSE, -- sin confirmar no puede iniciar sesión
    correo_sec VARCHAR(100),
    hash_pass VARCHAR(255) NOT NULL,
    id_telegram VARCHAR(50),
    rol ENUM('propietario', 'admin') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tokens de recuperación de contraseña. Solo se guarda el hash.
CREATE TABLE token (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    hash_token VARCHAR(255) NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_expiracion DATETIME NOT NULL,
    usado BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE KEY uq_token_hash (hash_token),
    FOREIGN KEY (id_usuario) REFERENCES usuario(id)
);

-- Especialización 1:1 de `usuario`: el id es a la vez PK y FK.
CREATE TABLE propietario (
    id INT PRIMARY KEY,
    status_dms VARCHAR(50) NOT NULL,
    -- Cola de eliminación de cuenta (derecho de cancelación ARCO): mientras
    -- `eliminacion_solicitada_en` no sea NULL la cuenta está "bloqueada" y un
    -- job la purga al cumplirse el periodo de gracia.
    eliminacion_solicitada_en DATETIME NULL,
    eliminacion_recordatorio_enviado BOOLEAN NOT NULL DEFAULT 0,
    ultima_prueba DATETIME,
    periodicidad_prueba INT DEFAULT 60,          -- umbral de inactividad (días): 30 | 45 | 60
    periodicidad_periodo_gracia INT DEFAULT 7,   -- periodo de gracia (días): 7 | 14 | 21
    -- Interruptor de Hombre Muerto (Máquina 1). status_dms recorre
    -- activo -> alerta -> gracia -> gracia_reduccion -> liberado
    -- (+ pausado_eliminacion / eliminado, ortogonales: cola de baja de cuenta).
    dms_alerta_en        DATETIME NULL,          -- entrada a 'alerta' (75% del umbral)
    dms_gracia_en        DATETIME NULL,          -- entrada a 'gracia' (umbral vencido)
    dms_reduccion_hasta  DATETIME NULL,          -- límite del temporizador de 'gracia_reduccion'
    dms_liberado_en      DATETIME NULL,          -- disparo del interruptor
    dms_reconfirmaciones SMALLINT NOT NULL DEFAULT 0,   -- reconfirmaciones de vida usadas (tope N)
    dms_roster_ronda     JSON NULL,              -- ids de custodios participantes, congelados en 'alerta'
    dms_quorum           SMALLINT NULL,          -- k = floor(Nc/2)+1, congelado en 'alerta'
    dms_ronda            SMALLINT NOT NULL DEFAULT 0,   -- ronda de votación de custodios vigente
    dms_ultimo_aviso     DATETIME NULL,          -- último envío de notificación del DMS (control de cadencia)
    CONSTRAINT chk_periodicidad_prueba CHECK (periodicidad_prueba IN (30, 45, 60)),
    CONSTRAINT chk_periodicidad_gracia CHECK (periodicidad_periodo_gracia IN (7, 14, 21)),
    FOREIGN KEY (id) REFERENCES usuario(id)
);


-- ==========================================================================
-- Suscripciones (solo ciclo anual)
-- ==========================================================================

-- Catálogo de planes. `costo_anual` = 0 identifica el plan gratuito.
CREATE TABLE suscripcion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL,
    max_almacenamiento INT NOT NULL,          -- GB
    max_bovedas INT NOT NULL,
    max_custodios INT NOT NULL,
    costo_anual DECIMAL(10,2) NOT NULL DEFAULT 0.00
);

-- Historial de contrataciones del propietario (puente N:M). Cada fila es un
-- periodo [fecha_inicio, fecha_fin): un plan de pago dura un año y al
-- contratarlo se agenda el Gratuito que lo sucede. La vigente es la que
-- cubre el día de hoy.
CREATE TABLE propietario_suscripcion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_propietario INT NOT NULL,
    id_suscripcion INT NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE,                           -- exclusiva, NULL = sin caducidad (Gratuito)
    paypal_order_id VARCHAR(64),              -- orden de PayPal que la pagó (NULL sin pasarela)
    cancelada_en DATETIME NULL,               -- canceló: no renovará, pero sigue vigente hasta fecha_fin
    UNIQUE KEY uq_prop_susc_paypal_order (paypal_order_id),   -- una orden, un solo uso
    FOREIGN KEY (id_propietario) REFERENCES propietario(id),
    FOREIGN KEY (id_suscripcion) REFERENCES suscripcion(id)
);


-- ==========================================================================
-- Prueba de vida y verificación de canales del propietario
-- ==========================================================================

-- Historial de pruebas de vida.
CREATE TABLE prueba_vida_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_propietario INT NOT NULL,
    fecha_prueba DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metodo ENUM('web_interface', 'telegram_bot', 'email_auth') NOT NULL,
    identificador VARCHAR(150),   -- correo usado o chat_id de Telegram, según el método
    ip_origen VARCHAR(45),        -- NULL cuando el origen es un webhook (Telegram) sin IP de cliente
    dias_extendidos INT NOT NULL, -- snapshot de periodicidad_prueba al momento del check-in
    FOREIGN KEY (id_propietario) REFERENCES propietario(id)
);

CREATE TABLE verificacion_correo_sec (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    correo_nuevo VARCHAR(100) NOT NULL,
    hash_token VARCHAR(255) NOT NULL,
    fecha_expiracion DATETIME NOT NULL,
    usado BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE KEY uq_verif_correo_sec_hash (hash_token),
    FOREIGN KEY (id_usuario) REFERENCES usuario(id)
);

-- Confirmación del correo principal al registrarse. Solo se guarda el hash.
CREATE TABLE verificacion_correo_registro (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    hash_token VARCHAR(255) NOT NULL,
    fecha_expiracion DATETIME NOT NULL,
    usado BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE KEY uq_verif_correo_registro_hash (hash_token),
    FOREIGN KEY (id_usuario) REFERENCES usuario(id)
);


-- ==========================================================================
-- Custodios (CU-010 a CU-014)
-- ==========================================================================
-- Directorio de contactos de confianza del propietario. Los custodios NO
-- son cuentas de usuario: no tienen login, contraseña ni fila en `usuario`.
-- SIN FK a bóveda: es un directorio independiente por propietario (modelo
-- N:M). La vinculación custodio <-> bóveda vive en `custodios_bovedas`.

CREATE TABLE custodios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_propietario INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    paterno VARCHAR(100),
    materno VARCHAR(100),
    parentesco VARCHAR(50) NOT NULL DEFAULT 'Familiar',
    correo VARCHAR(100) NOT NULL,
    correo_verificado BOOLEAN NOT NULL DEFAULT FALSE,
    telegram_chat_id VARCHAR(50) NULL,        -- capturado cuando el custodio interactúa con el bot
    telegram_verificado BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Un mismo correo no puede repetirse en el directorio del propietario.
    UNIQUE KEY uq_cust_prop_correo (id_propietario, correo),
    FOREIGN KEY (id_propietario) REFERENCES propietario(id)
);

-- Códigos de un solo uso para vincular Telegram. Se emiten a nombre del
-- propietario (id_usuario) o de un custodio (id_custodio).
CREATE TABLE telegram_link_code (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NULL,
    id_custodio INT NULL,
    hash_codigo VARCHAR(255) NOT NULL UNIQUE,
    fecha_expiracion DATETIME NOT NULL,
    usado BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (id_usuario) REFERENCES usuario(id),
    CONSTRAINT fk_telegram_link_code_custodio
        FOREIGN KEY (id_custodio) REFERENCES custodios(id)
);

-- Tokens de un solo uso para que el custodio confirme su correo desde el
-- link recibido. Se guardan hasheados con core.security.hash_token(), nunca
-- en claro.
CREATE TABLE verificacion_custodio (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_custodio INT NOT NULL,
    canal ENUM('correo') NOT NULL,
    destino VARCHAR(150) NOT NULL,
    hash_token VARCHAR(255) NOT NULL,
    fecha_expiracion DATETIME NOT NULL,
    usado BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE KEY uq_verif_custodio_hash (hash_token),
    FOREIGN KEY (id_custodio) REFERENCES custodios(id)
);


-- ==========================================================================
-- Bóvedas y motor criptográfico (Shamir Secret Sharing + Feldman VSS sobre
-- secp256k1, ejecutado 100% en el navegador vía WebAssembly).
--
-- PRINCIPIO ZERO-KNOWLEDGE: el servidor NUNCA recibe ni almacena la llave
-- maestra (AES-256 = escalar de 32 B) ni los fragmentos reales (los valores
-- `y` de cada share). Solo persiste:
--   * los COMPROMISOS Feldman (públicos, no revelan el secreto)
--   * metadatos: umbral k, total n y estado
--   * qué coordenada `x` (no secreta) le tocó a cada custodio
--
-- Cada bóveda tiene su propia PASS-PHRASE (elegida por el usuario o generada
-- con alta entropía en el navegador). De ella se DERIVA, con un KDF cliente
-- (Argon2id), la llave AES-256 (DEK) que:
--   * cifra/descifra los activos de la bóveda, y
--   * es exactamente el secreto de 32 B que se fragmenta con Shamir.
-- El servidor NUNCA ve la pass-phrase ni la DEK. Solo guarda:
--   * kdf_algo / kdf_salt / kdf_params  -> cómo re-derivar la DEK (no secretos)
--   * passphrase_verificador            -> hash para comprobar que la
--     pass-phrase escrita es correcta antes de cada operación (consultar o
--     actualizar activos, etc.). NO permite recuperar la DEK.
-- Para BORRAR la bóveda se usa la contraseña de la CUENTA, no la pass-phrase.
--
-- Restricción de n y k (se valida en el backend y en el frontend):
--   floor(n/2) + 1 <= k < n,  con n >= 3.
-- ==========================================================================

CREATE TABLE bovedas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pid CHAR(22) NOT NULL UNIQUE,                 -- identificador público urlsafe (CU-029, portal sin login)
    id_propietario INT NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    categoria VARCHAR(50),
    mensaje_custodios TEXT,                       -- nota opcional que verán los custodios en la recuperación
    kdf_algo VARCHAR(20) NOT NULL DEFAULT 'argon2id',
    kdf_salt VARCHAR(64) NOT NULL,                -- hex (8..32 B), NO secreto
    kdf_params JSON NOT NULL,                     -- p.ej. {"t":3,"m":65536,"p":4}
    passphrase_verificador CHAR(64) NOT NULL,     -- sha256(verifier que manda el cliente), solo para comparar
    umbral_k SMALLINT UNSIGNED,                   -- NULL hasta que se suben los compromisos
    total_fragmentos_n SMALLINT UNSIGNED,
    estado ENUM('borrador', 'activa', 'en_recuperacion', 'expirada')
           NOT NULL DEFAULT 'borrador',
    recuperacion_iniciada_en DATETIME NULL,       -- ancla de la ventana W al pasar a 'en_recuperacion'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_propietario) REFERENCES propietario(id)
);

-- Compromisos Feldman VSS de cada bóveda (1:1 con `bovedas`).
-- commitments_hex = k puntos comprimidos SEC1 (33 B c/u) concatenados y en
-- hex. C_j = g^{a_j} de los coeficientes del polinomio, con a_0 = secreto.
-- Se usan para verificar cada fragmento aportado por un custodio SIN
-- conocer el secreto:  g^y == Π_{j} C_j^{(x^j mod N)}.
CREATE TABLE vss_commitments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_boveda INT NOT NULL UNIQUE,
    commitments_hex TEXT NOT NULL,                -- longitud = k * 33 * 2 hex chars
    x_coords JSON NOT NULL,                       -- las n coordenadas x del reparto (no son secretas)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_boveda) REFERENCES bovedas(id)
);

-- Puente N:M custodio <-> bóveda + la coordenada `x` del fragmento que
-- custodia. Un custodio vinculado a varias bóvedas tiene una fila (y una x)
-- por bóveda. La `x` NO es secreta: el valor `y` del fragmento solo existe
-- en el archivo .sss que el propietario le entregó al custodio manualmente.
CREATE TABLE custodios_bovedas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_custodio INT NOT NULL,
    id_boveda INT NOT NULL,
    x_fragmento SMALLINT UNSIGNED NOT NULL,       -- 1..65535
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY id_boveda (id_boveda, id_custodio),     -- un custodio a lo sumo un fragmento por bóveda
    UNIQUE KEY id_boveda_2 (id_boveda, x_fragmento),   -- cada fragmento a lo sumo un custodio
    FOREIGN KEY (id_custodio) REFERENCES custodios(id),
    FOREIGN KEY (id_boveda) REFERENCES bovedas(id)
);


-- ==========================================================================
-- Interruptor de Hombre Muerto (Máquina 1): atestaciones de custodios
-- ==========================================================================
-- Al entrar a 'gracia' (y en cada reinicio de 'gracia_reduccion') se emite
-- una fila por cada custodio del roster congelado en 'alerta'
-- (propietario.dms_roster_ronda), con un token de un solo uso hasheado. El
-- custodio vota 'vida' o 'fallecimiento' desde el enlace del correo.
--
-- El voto solo se registra si el custodio aporta un fragmento Feldman VSS
-- válido (verificado en su navegador) cuya x coincida con la que tiene
-- asignada en `custodios_bovedas`. id_boveda / x_fragmento quedan como
-- auditoría de qué fragmento validó el voto (no participan en el quórum).
--
-- El quórum global k = floor(Nc/2)+1 cuenta filas de la ronda vigente con
-- voto emitido dentro de los últimos DMS_VOTO_TTL_DIAS días.
CREATE TABLE dms_atestacion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_propietario INT NOT NULL,
    id_custodio INT NOT NULL,
    ronda SMALLINT NOT NULL,
    sentido ENUM('vida', 'fallecimiento') NULL,   -- NULL = token emitido, sin votar
    hash_token CHAR(64) NOT NULL,
    emitido_en DATETIME NOT NULL,
    votado_en DATETIME NULL,
    id_boveda INT NULL,                           -- auditoría: bóveda del fragmento que validó el voto
    x_fragmento SMALLINT UNSIGNED NULL,           -- auditoría: coordenada x de ese fragmento
    UNIQUE KEY uq_atest_prop_cust_ronda (id_propietario, id_custodio, ronda),
    INDEX idx_atest_token (hash_token),
    FOREIGN KEY (id_propietario) REFERENCES propietario(id),
    FOREIGN KEY (id_custodio) REFERENCES custodios(id),
    -- SET NULL: un voto viejo no debe impedir borrar la bóveda.
    CONSTRAINT fk_atest_boveda
        FOREIGN KEY (id_boveda) REFERENCES bovedas(id) ON DELETE SET NULL
);


-- ==========================================================================
-- Activos digitales de una bóveda
-- ==========================================================================
-- El contenido se cifra en el navegador con AES-256-GCM usando la DEK de la
-- bóveda (nonce = `iv`). El servidor SOLO guarda metadatos + la ruta del
-- blob en Azure Blob Storage. Nunca ve texto plano ni la DEK.
-- Flujo: 'pendiente' al pedir el SAS de escritura -> 'activo' cuando el
-- navegador confirma que el blob ya se subió.
CREATE TABLE activos_digitales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_boveda INT NOT NULL,
    nombre_original VARCHAR(255) NOT NULL,
    mime VARCHAR(120),
    plantilla VARCHAR(40),                       -- id de plantilla de credenciales (NULL = archivo subido normal)
    tamano_bytes BIGINT UNSIGNED NOT NULL,       -- del archivo en claro (lo informa el cliente)
    tamano_cifrado BIGINT UNSIGNED NOT NULL,     -- del ciphertext, es lo que cuenta para la cuota
    blob_name VARCHAR(200) NOT NULL,             -- <pid>/<uuid>
    iv BINARY(12) NOT NULL,                      -- nonce AES-GCM
    sha256_plano CHAR(64),                       -- verificación opcional (hex del archivo en claro)
    estado ENUM('pendiente', 'activo') NOT NULL DEFAULT 'pendiente',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_activo_blob (blob_name),
    FOREIGN KEY (id_boveda) REFERENCES bovedas(id)
);


-- ==========================================================================
-- Sesión efímera de recuperación (CU-030 a CU-035)
-- ==========================================================================
-- Cuando una bóveda pasa a 'en_recuperacion', cualquiera con un fragmento
-- válido (verificado contra vss_commitments, en el navegador) puede fundar
-- una sesión como Beneficiario Principal (BP) o unirse a una ya activa como
-- custodio. A lo sumo una sesión 'activa' por bóveda a la vez.
--
-- ZERO-KNOWLEDGE: el servidor NUNCA ve un fragmento (x,y) en claro. Cada
-- participante cifra su fragmento con ECIES (X25519 + AES-256-GCM) hacia la
-- llave pública de sesión del BP. El servidor solo reenvía el ciphertext y
-- no puede validarlo: la validación VSS ocurre en el navegador de quien
-- deposita, ANTES de cifrar, así que un fragmento inválido nunca llega a
-- generar ciphertext.
--
-- La llave PRIVADA del BP nunca se guarda en ningún lado (ni cifrada): se
-- re-deriva de su pass-phrase de sesión (bp_kdf_salt/params, PBKDF2) cada
-- vez que la necesita, igual que la DEK de una bóveda se deriva de su
-- pass-phrase (ver bovedas.kdf_salt). Solo la llave PÚBLICA (no secreta) se
-- guarda para que los demás cifren hacia ella.
--
-- RN "no el mismo BP de inmediato": quien fundó una sesión que no llegó a
-- quórum no puede fundar otra hasta que se hayan creado (n-k) sesiones más
-- para esa bóveda. Se resuelve consultando x_fundador de las últimas (n-k)
-- filas de sesiones_recuperacion para esa bóveda, sin contador aparte.
CREATE TABLE sesiones_recuperacion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_boveda INT NOT NULL,
    x_fundador SMALLINT UNSIGNED NOT NULL,        -- coordenada x del fragmento fundador (para el cooldown)
    bp_public_key CHAR(64) NOT NULL,              -- X25519, 32 B en hex, NO secreta
    bp_kdf_algo VARCHAR(20) NOT NULL DEFAULT 'pbkdf2-sha256',
    bp_kdf_salt VARCHAR(64) NOT NULL,             -- hex, NO secreto: re-deriva la llave privada del BP
    bp_kdf_params JSON NOT NULL,
    estado ENUM('activa', 'expirada', 'abandonada') NOT NULL DEFAULT 'activa',
    creada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expira_en DATETIME NOT NULL,                  -- creada_en + RECUPERACION_SESION_HORAS
    -- Reporte informativo del navegador del BP tras su primera
    -- reconstrucción exitosa de la DEK (el servidor no puede comprobarlo).
    -- Se fija una sola vez por sesión.
    reconstruido_en DATETIME NULL,
    FOREIGN KEY (id_boveda) REFERENCES bovedas(id)
);

-- Un fragmento cifrado hacia la llave pública de la sesión vigente.
-- ciphertext_hex = AES-256-GCM(x || y) con el secreto ECDH(epk, bp_public_key).
-- id_custodio es NULL cuando la x no coincide con ningún custodio ya
-- registrado en custodios_bovedas para esa bóveda. El fragmento sigue
-- siendo la credencial válida por sí mismo, el match es solo informativo.
CREATE TABLE fragmentos_depositados (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_sesion INT NOT NULL,
    x_fragmento SMALLINT UNSIGNED NOT NULL,
    epk_hex CHAR(64) NOT NULL,                    -- llave pública X25519 efímera de quien deposita
    iv BINARY(12) NOT NULL,                       -- nonce AES-GCM
    ciphertext_hex TEXT NOT NULL,
    nombre_declarado VARCHAR(150) NOT NULL,
    vinculo_declarado VARCHAR(50) NOT NULL,
    id_custodio INT NULL,
    depositado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_frag_sesion_x (id_sesion, x_fragmento),
    FOREIGN KEY (id_sesion) REFERENCES sesiones_recuperacion(id),
    FOREIGN KEY (id_custodio) REFERENCES custodios(id)
);


-- ==========================================================================
-- Notificaciones y administración
-- ==========================================================================

-- Outbox transaccional de notificaciones (correo y Telegram). Cada aviso se
-- inserta en la misma transacción que el cambio que lo provoca y un worker
-- lo entrega con reintentos. `datos_cifrados` guarda los parámetros de la
-- plantilla cifrados y se borra en cuanto el aviso se envía o se da por
-- perdido.
CREATE TABLE notificacion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    canal ENUM('correo', 'telegram') NOT NULL,
    destino VARCHAR(150) NOT NULL,
    plantilla VARCHAR(60) NOT NULL,
    datos_cifrados TEXT NULL,
    estado ENUM('pendiente', 'enviada', 'fallida') NOT NULL DEFAULT 'pendiente',
    intentos SMALLINT NOT NULL DEFAULT 0,
    siguiente_intento_en DATETIME NOT NULL,
    ultimo_error VARCHAR(255) NULL,
    creada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    enviada_en DATETIME NULL,
    INDEX idx_notif_pendientes (estado, siguiente_intento_en)
);

-- Bitácora append-only del panel admin: quién (admin), sobre qué
-- propietario, qué acción y por qué. Ninguna acción admin se aplica sin
-- dejar aquí su motivo.
CREATE TABLE admin_auditoria (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_admin INT NOT NULL,
    id_propietario_afectado INT NULL,
    accion ENUM(
        'cancelar_eliminacion',
        'purgar_cuenta',
        'extender_plazo_dms',
        'reenviar_aviso_dms',
        'forzar_barrido_dms',
        'reenviar_verificacion_custodio',
        'cambiar_plan',
        'reintentar_notificaciones'
    ) NOT NULL,
    motivo VARCHAR(500) NOT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_admin_aud_admin (id_admin),
    INDEX idx_admin_aud_propietario (id_propietario_afectado, creado_en),
    FOREIGN KEY (id_admin) REFERENCES usuario(id),
    FOREIGN KEY (id_propietario_afectado) REFERENCES propietario(id)
);


-- ==========================================================================
-- Datos iniciales
-- ==========================================================================

-- Catálogo de planes (costo_anual en la moneda de PAYPAL_CURRENCY). El
-- Gratuito debe ser el id 1 (cuota.ID_PLAN_GRATUITO en el backend).
INSERT INTO suscripcion (id, nombre, max_almacenamiento, max_bovedas, max_custodios, costo_anual)
VALUES
    (1, 'Gratuito', 1, 1, 5, 0.00),
    (2, 'Premium', 50, 10, 20, 9990.00);
