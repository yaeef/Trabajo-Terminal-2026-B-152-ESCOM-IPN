# backend/app/core/config.py
"""
Configuración leída del entorno (docker-compose pasa las variables desde
.env). `BaseSettings` ya lee cada campo de la variable de entorno del mismo
nombre y convierte el tipo; los valores de aquí son solo los defaults.
"""

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Valores públicos (el default que traía el código y el de .env.example): si
# aparecen, alguien arrancó sin configurar la llave y cualquiera podría
# firmar JWT válidos con ella.
_SECRET_KEYS_INSEGURAS = {"super_secreto_desarrollo", "CAMBIAR_por_una_clave_aleatoria_de_64_hex"}
_SECRET_KEY_MIN_LEN = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Obligatorias: sin default a propósito (la de BD llevaba credenciales
    # en claro; la llave de JWT, un valor conocido públicamente).
    DATABASE_URL: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    # --- API ---
    # Orígenes permitidos por CORS, separados por coma. "*" sirve en
    # desarrollo (se entra desde localhost y desde la IP de LAN): la sesión
    # viaja en el header Authorization, no en cookies, así que no se
    # habilitan credenciales CORS.
    CORS_ORIGINS: str = "*"
    # Swagger/OpenAPI públicos; conviene apagarlos en producción.
    ENABLE_DOCS: bool = True
    # Hilos en segundo plano: entrega de notificaciones y barrido periódico
    # (ver services/tareas_periodicas.py). Las pruebas los apagan.
    SCHEDULER_ENABLED: bool = True

    # Nombre del producto en correos, Telegram y PayPal.
    MARCA: str = "Kleimos Legacy"

    # --- Correo saliente (SMTP; Mailpit en desarrollo, ver docker-compose.yml) ---
    SMTP_HOST: str = "mailpit"
    SMTP_PORT: int = 1025
    SMTP_FROM_EMAIL: str = "b152@localhost"
    # Mailpit no exige autenticación; se dejan vacíos salvo que se apunte a un SMTP real.
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = False

    # --- Telegram ---
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_BOT_USERNAME: str = ""  # sin @, para el deep link
    # Valida que el webhook venga de Telegram; vacío = webhook cerrado.
    TELEGRAM_WEBHOOK_SECRET: str = ""

    # --- Frontend: enlaces que se mandan por correo/Telegram ---
    FRONTEND_BASE_URL: str = "http://localhost:5173"
    FRONTEND_RESET_URL: str = "http://localhost:5173/reset-password"
    FRONTEND_CONFIRM_EMAIL_URL: str = "http://localhost:5173/confirmar-correo"
    FRONTEND_CONFIRM_REGISTRO_URL: str = "http://localhost:5173/confirmar-registro"
    FRONTEND_CONFIRM_CUSTODIO_URL: str = "http://localhost:5173/confirmar-custodio"
    FRONTEND_DMS_VOTO_URL: str = "http://localhost:5173/atestacion"

    # --- Azure Blob Storage / Azurite: blobs cifrados de los activos digitales ---
    AZURE_STORAGE_CONNECTION_STRING: str = ""
    AZURE_ACTIVOS_CONTAINER: str = "activos"
    # El SAS que se devuelve al navegador debe apuntar a un host alcanzable
    # DESDE EL NAVEGADOR (Azurite es "azurite:10000" dentro de docker, pero
    # "localhost:10000" desde el equipo). La firma del SAS no incluye el host,
    # así que se puede intercambiar sin invalidarlo.
    AZURE_BLOB_PUBLIC_ENDPOINT: str = "http://localhost:10000/devstoreaccount1"

    # --- PayPal (pasarela para cambios a un plan de pago) ---
    # Sin credenciales, el frontend cae en "simular pago". Con credenciales de
    # una app REST del PayPal Developer Dashboard se ejecuta el flujo real
    # (create order -> aprobación del comprador -> capture).
    PAYPAL_MODE: str = "sandbox"  # sandbox | live
    PAYPAL_CLIENT_ID: str = ""
    PAYPAL_CLIENT_SECRET: str = ""
    PAYPAL_CURRENCY: str = "MXN"

    # --- Eliminación de cuenta con periodo de gracia ---
    ACCOUNT_DELETION_GRACE_DAYS: int = 30
    # Días antes de la purga en que se manda el correo recordatorio.
    ACCOUNT_DELETION_REMINDER_DAYS: int = 3

    # --- Interruptor de Hombre Muerto (Máquina 1) ---
    # Fracción del umbral de inactividad a la que se entra en 'alerta'.
    DMS_ALERTA_PORCENTAJE: float = 0.75
    # Temporizador (días) del estado 'gracia_reduccion'.
    DMS_REDUCCION_DIAS: int = 30
    # Tope de reconfirmaciones de vida por custodios antes de liberar.
    DMS_MAX_RECONFIRMACIONES: int = 3
    # Cooldown (horas) desde la ronda anterior antes de que un nuevo quórum
    # de 'vida' en 'gracia_reduccion' cuente como reconfirmación: evita que
    # varias rondas seguidas en poco tiempo agoten DMS_MAX_RECONFIRMACIONES.
    DMS_COOLDOWN_RECONFIRMACION_HORAS: int = 0
    # Vigencia (días) de un voto de custodio dentro de su ronda.
    DMS_VOTO_TTL_DIAS: int = 14
    # Ventana (días) de recuperación por bóveda tras el disparo (RN-002). Al
    # vencer, la bóveda se elimina con todos sus archivos.
    DMS_RECOVERY_WINDOW_DIAS: int = 365

    # --- Renovación, año de reserva e impago (services/suscripcion_service.py
    #     y services/impago.py) ---
    # Días antes del vencimiento desde los que se puede renovar (y se avisa).
    RENOVACION_VENTANA_DIAS: int = 30
    # Tras el vencimiento, días en que con año de reserva aún se puede
    # renovar sin gastarla.
    RESERVA_GRACIA_DIAS: int = 30
    # Al terminar la cobertura de pago, días que se conserva lo que excede el
    # plan Gratuito antes del recorte (debe superar el 75 % del umbral máximo
    # del DMS, 60 días, para que un fallecido ya esté en alerta al llegar).
    IMPAGO_PLAZO_DIAS: int = 60
    # Si el recorte estaba en pausa (DMS no activo) y el propietario confirma
    # que vive, días que se le dan antes de recortar.
    IMPAGO_REPROGRAMACION_DIAS: int = 15

    # --- Sesión efímera de recuperación (CU-030 a CU-035) ---
    # Vigencia de una sesión desde que se funda hasta que expira sola, si nadie
    # la abandona antes. Independiente de DMS_RECOVERY_WINDOW_DIAS (esa es la
    # ventana total de la bóveda; esta es cada intento de sesión dentro de ella).
    RECUPERACION_SESION_HORAS: int = 48

    @field_validator("SECRET_KEY")
    @classmethod
    def _secret_key_robusta(cls, v: str) -> str:
        v = (v or "").strip()
        if v in _SECRET_KEYS_INSEGURAS or len(v) < _SECRET_KEY_MIN_LEN:
            raise ValueError(
                f"SECRET_KEY debe definirse en el entorno con al menos {_SECRET_KEY_MIN_LEN} "
                "caracteres aleatorios (p. ej. `openssl rand -hex 32`)."
            )
        return v

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
