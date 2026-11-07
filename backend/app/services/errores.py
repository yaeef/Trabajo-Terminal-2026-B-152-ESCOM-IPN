"""
Errores de dominio: un caso de uso no puede completarse por una regla de
negocio. Los servicios lanzan estas clases (o subclases con nombre propio,
p. ej. `BovedaNoEncontrada`) y la capa HTTP las traduce en un solo lugar
(api/errores.py); los servicios no saben nada de HTTP.

Un `ValueError` u otra excepción que NO herede de aquí es un error de
programación y termina en 500, no se disfraza de error del usuario.
"""


class ErrorDeDominio(Exception):
    """Base de todos los errores esperables de un caso de uso."""


class DatoInvalido(ErrorDeDominio):
    """La petición no cumple una regla de negocio (contraseña incorrecta, enlace vencido...)."""


class NoEncontrado(ErrorDeDominio):
    """El recurso no existe o no pertenece a quien lo pide."""


class Conflicto(ErrorDeDominio):
    """La operación choca con el estado actual del recurso."""


class Prohibido(ErrorDeDominio):
    """Quien pide la operación no tiene la credencial que se exige."""


class ServicioNoDisponible(ErrorDeDominio):
    """Un servicio externo necesario no está configurado."""


class ErrorExterno(ErrorDeDominio):
    """Un servicio externo respondió con un error."""
