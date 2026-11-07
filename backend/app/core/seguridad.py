"""Contraseñas (Argon2id), hash de tokens de un solo uso y JWT de acceso."""

import hashlib
import secrets
from datetime import timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher, Type
from argon2.exceptions import Argon2Error, InvalidHashError

from app.core.config import settings
from app.core.tiempo import ahora

# Argon2id con parámetros explícitos (hash en formato PHC estándar).
_hasher = PasswordHasher(
    time_cost=3,  # iteraciones
    memory_cost=65536,  # 64 MiB
    parallelism=4,
    hash_len=32,
    salt_len=16,
    type=Type.ID,  # Argon2id: híbrido, resistente a side-channel y GPU cracking
)

# Argon2 no trunca la contraseña como bcrypt, pero igual conviene
# poner un límite razonable para evitar abuso (DoS por passwords gigantes).
LONGITUD_MAX_CONTRASENA = 128

# Hash de una contraseña que nadie conoce: el login lo verifica cuando el
# usuario no existe, para que ese caso tarde lo mismo que una contraseña
# incorrecta (si no, el tiempo de respuesta revela qué cuentas existen).
_HASH_SENUELO = _hasher.hash(secrets.token_urlsafe(32))


def verificar_contrasena(contrasena: str, hash_guardado: str) -> bool:
    """Verifica una contraseña contra su hash. Nunca lanza excepción hacia afuera."""
    if len(contrasena or "") > LONGITUD_MAX_CONTRASENA:
        return False
    try:
        return _hasher.verify(hash_guardado, contrasena)
    except (Argon2Error, InvalidHashError):
        return False


def verificar_contrasena_senuelo(contrasena: str) -> bool:
    """Mismo costo que `verificar_contrasena`, siempre False (usuario inexistente)."""
    verificar_contrasena(contrasena, _HASH_SENUELO)
    return False


def hash_contrasena(contrasena: str) -> str:
    """Genera el hash Argon2id de una contraseña."""
    if len(contrasena) > LONGITUD_MAX_CONTRASENA:
        raise ValueError(
            f"La contraseña excede el máximo permitido de {LONGITUD_MAX_CONTRASENA} caracteres."
        )
    return _hasher.hash(contrasena)


def hash_token(token: str) -> str:
    """
    SHA-256 de un token de un solo uso (recuperación de contraseña,
    confirmación del registro y de correos, códigos de Telegram, enlaces de
    voto del DMS...). En la BD solo se guarda este hash: el valor en claro
    existe en memoria el tiempo justo para mandarlo por correo/Telegram.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def crear_token_acceso(sujeto: str) -> str:
    """
    Crea el JWT de acceso, firmado con `settings.ALGORITHM` (HS256) y con
    caducidad `ACCESS_TOKEN_EXPIRE_MINUTES`. `sujeto` es el id del usuario
    como texto (api/dependencias.obtener_usuario_actual lo vuelve a int).
    """
    momento = ahora()
    reclamos = {
        "sub": sujeto,
        "type": "access",
        "iat": momento,
        "exp": momento + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(reclamos, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decodificar_token_acceso(token: str) -> dict[str, Any] | None:
    """
    Decodifica y valida un JWT de acceso. Devuelve sus reclamos, o None si
    es inválido, expiró, fue manipulado o no es de tipo "access".
    """
    try:
        datos = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        return None
    if datos.get("type") != "access":
        return None
    return datos
