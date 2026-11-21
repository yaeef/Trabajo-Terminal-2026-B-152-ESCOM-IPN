"""Servidor local de las pruebas del cliente (solo biblioteca estándar).

Sirve la página de pruebas y el motor WebAssembly, y guarda en JSON lo que la
página envía a POST /resultados?nav=<nombre>. Agrega COOP/COEP para que la
página quede aislada (crossOriginIsolated) y performance.now() tenga la mayor
resolución que permite cada navegador.

Uso: python3 servidor.py <dir_compilado> <dir_wasm> <dir_resultados> [puerto]
"""

import json
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

COMPILADO, WASM, RESULTADOS = (Path(p).resolve() for p in sys.argv[1:4])
PUERTO = int(sys.argv[4]) if len(sys.argv) > 4 else 8137
RESULTADOS.mkdir(parents=True, exist_ok=True)


class Manejador(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        ruta = urlparse(path).path
        if ruta.startswith("/wasm/"):
            return str(WASM / ruta.removeprefix("/wasm/"))
        return str(COMPILADO / (ruta.lstrip("/") or "index.html"))

    def end_headers(self) -> None:
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self) -> None:
        url = urlparse(self.path)
        if url.path != "/resultados":
            self.send_error(404)
            return
        nav = parse_qs(url.query).get("nav", ["desconocido"])[0]
        nav = "".join(c for c in nav if c.isalnum() or c in "-_") or "desconocido"
        cuerpo = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        (RESULTADOS / f"{nav}.json").write_text(json.dumps(cuerpo, ensure_ascii=False, indent=2))
        self.send_response(204)
        self.end_headers()

    def log_message(self, *args) -> None:  # silencioso
        pass


ThreadingHTTPServer(("127.0.0.1", PUERTO), Manejador).serve_forever()
