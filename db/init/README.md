# Esquema de la base de datos

`001_init_schema.sql` es la **única definición del esquema**: crea todas
las tablas y el catálogo de planes. No hay migraciones.

MariaDB lo ejecuta **una sola vez**, al crear el volumen de datos por
primera vez (`/docker-entrypoint-initdb.d`). La suite de pruebas también lo
usa para crear su BD (`backend/tests/esquema.py`).

## Cambios de esquema

1. Edita `001_init_schema.sql` y el modelo ORM correspondiente en
   `backend/app/models/` (`tests/test_modelos_vs_bd.py` falla si no
   coinciden).
2. Una base que ya existía no vuelve a leer este archivo. Para que tome el
   cambio hay que recrearla, lo que **borra todos sus datos** (`-v` también
   borra los blobs de Azurite, que sin la BD quedarían huérfanos):

```bash
docker compose down -v
docker compose up
```
