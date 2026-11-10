# syntax=docker/dockerfile:1
#
# runtime: imagen de ejecución (solo dependencias de producción, usuario sin
#          privilegios, sin recarga automática).

FROM python:3.11-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
# UID/GID 1000: coincide con el usuario habitual del host, así el código
# montado como volumen en desarrollo sigue siendo legible y escribible.
RUN groupadd --system --gid 1000 app \
    && useradd --system --uid 1000 --gid app --home-dir /app --shell /usr/sbin/nologin app

FROM base AS runtime
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY --chown=app:app . .
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
