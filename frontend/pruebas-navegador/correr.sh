#!/usr/bin/env bash
# Corre las pruebas del cliente (CLT) y las mediciones en Firefox (instalado en
# el equipo) y en Chrome y Brave (contenedor navegadores.Dockerfile).
#   ./correr.sh [clt|bench]   (por defecto: clt)
# Resultados: ./resultados/<navegador>-<suite>.json
set -euo pipefail
cd "$(dirname "$0")"
SUITE=${1:-clt}
AQUI=$PWD
DIST=$(mktemp -d)
PERFIL=$(mktemp -d)
PUERTO=8137
mkdir -p resultados

# 1. Compilar la página con el esbuild de la imagen del frontend.
docker run --rm -v "$AQUI/..:/src:ro" -v "$DIST:/out" -e NODE_PATH=/app/node_modules \
  --entrypoint sh tt2-final-frontend:latest -c \
  "cd /app && ./node_modules/.bin/esbuild /src/pruebas-navegador/clt.ts --bundle --format=esm \
   --target=es2020 --outfile=/out/clt.js --define:import.meta.env.BASE_URL='\"/\"' && cp /src/pruebas-navegador/index.html /out/"

# 2. Servidor local (página, motor WASM y receptor de resultados).
python3 servidor.py "$DIST" ../public/wasm resultados $PUERTO &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$DIST" "$PERFIL"' EXIT
sleep 1

esperar() {  # esperar <archivo> <proceso o contenedor> <segundos>
  for _ in $(seq 1 "$3"); do
    [ -f "$1" ] && grep -q '"completo": true' "$1" && return 0
    sleep 1
  done
  echo "tiempo agotado: $1" >&2
}

# 3. Firefox del equipo, en modo headless y con un perfil nuevo.
rm -f "resultados/firefox-$SUITE.json"
firefox --headless --no-remote --profile "$PERFIL" \
  "http://localhost:$PUERTO/?suite=$SUITE&nav=firefox-$SUITE" >/dev/null 2>&1 &
FF=$!
esperar "resultados/firefox-$SUITE.json" $FF 900
kill $FF 2>/dev/null || true

# 4. Chrome y Brave en el contenedor.
docker build -q -t tt2-navegadores -f navegadores.Dockerfile . >/dev/null
for par in chrome:google-chrome brave:brave-browser; do
  n=${par%%:*}; b=${par##*:}
  rm -f "resultados/$n-$SUITE.json"
  docker run -d --rm --name "tt2nav-$n" --network host --shm-size=4g tt2-navegadores \
    "$b" --headless=new --no-sandbox --disable-gpu --no-first-run --user-data-dir=/tmp/perfil \
    "http://localhost:$PUERTO/?suite=$SUITE&nav=$n-$SUITE" >/dev/null
  esperar "resultados/$n-$SUITE.json" "tt2nav-$n" 900
  docker kill "tt2nav-$n" >/dev/null 2>&1 || true
done

python3 - "$SUITE" <<'PY'
import json, sys, pathlib
for f in sorted(pathlib.Path('resultados').glob(f'*-{sys.argv[1]}.json')):
    d = json.loads(f.read_text())
    casos = d.get('casos', [])
    print(f.stem, f"{sum(c['ok'] for c in casos)}/{len(casos)} casos", d.get('error') or '')
    for m in d.get('mediciones', []):
        print(f"   {m['id']:28s} {m['media_ms']:10.3f} ± {m['de_ms']:.3f} ms")
PY
