"""Loopback-only, stateless viewer: existing Python geometry, browser display."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import socket

from last_shape import curve_points, bezier
from bottom_profile import bottom_curve_points
from contour_last import build_contour_last

ROOT = Path(__file__).resolve().parent
MAX_BODY = 64*1024
STATIC = {
    "/": ("web/index.html", "text/html; charset=utf-8"),
    "/index.html": ("web/index.html", "text/html; charset=utf-8"),
    "/app.js": ("web/app.js", "text/javascript; charset=utf-8"),
    "/scene.js": ("web/scene.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("web/styles.css", "text/css; charset=utf-8"),
    "/vendor/three/build/three.module.js": ("node_modules/three/build/three.module.js", "text/javascript; charset=utf-8"),
    "/vendor/three/build/three.core.js": ("node_modules/three/build/three.core.js", "text/javascript; charset=utf-8"),
    "/vendor/three/examples/jsm/controls/OrbitControls.js": ("node_modules/three/examples/jsm/controls/OrbitControls.js", "text/javascript; charset=utf-8"),
}


class InvalidModel(ValueError):
    def __init__(self, reports):
        super().__init__("Resulting geometry failed validation")
        self.reports = reports


def load_defaults():
    """Read fixed files each time, independent of cwd and earlier requests."""
    return json.loads((ROOT/"examples/contour-baseline.json").read_text())


def _check_json_values(value, depth=0):
    if depth > 64:
        raise ValueError("JSON nesting is too deep")
    if isinstance(value,float) and not math.isfinite(value):
        raise ValueError("JSON numbers must be finite")
    if isinstance(value,dict):
        for item in value.values():
            _check_json_values(item,depth+1)
    elif isinstance(value,list):
        for item in value:
            _check_json_values(item,depth+1)


def build_state(payload):
    """Use the existing geometry once. Samples embed guides for display only."""
    _check_json_values(payload)
    state = build_contour_last(payload)
    top,bottom = state["models"]["top"],state["models"]["bottom"]
    reports = state["reports"]
    if not all(report["passed"] for report in reports.values()):
        raise InvalidModel(reports)
    display = {"top": [], "bottom": []}
    for name in top["outline"]:
        samples = [bezier(curve_points(top,name),i/64) for i in range(65)]
        display["top"].append(dict(name=name,points=[[x,y,0] for x,y in samples]))
    for name in bottom["profile"]:
        samples = [bezier(bottom_curve_points(bottom,name),i/64) for i in range(65)]
        display["bottom"].append(dict(name=name,points=[[0,y,z] for y,z in samples]))
    state["display"] = display
    return state


def _reject_constant(value):
    raise ValueError("JSON numbers must be finite")


class ViewerHandler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_):
        pass

    def _reply(self, status, body, content_type="application/json; charset=utf-8"):
        if not isinstance(body,bytes):
            body = json.dumps(body,allow_nan=False).encode("utf-8")
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type",content_type)
        self.send_header("Content-Length",str(len(body)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Connection","close")
        self.end_headers()
        self.wfile.write(body)

    def _trusted(self):
        port = self.server.server_port
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if port == 80:
            hosts |= {"127.0.0.1","localhost"}
        if len(self.headers.get_all("Host",[])) != 1 or self.headers["Host"] not in hosts:
            self._reply(403,{"error":"Host must name this loopback server and port"})
            return False
        origins = self.headers.get_all("Origin",[])
        if len(origins)>1 or (origins and origins[0] not in {"http://"+host for host in hosts}):
            self._reply(403,{"error":"Origin must be this loopback server"})
            return False
        return True

    def do_GET(self):
        if not self._trusted():
            return
        try:
            if self.path == "/api/defaults":
                self._reply(200,load_defaults())
            elif self.path in STATIC:
                name,mime = STATIC[self.path]
                path = ROOT/name
                if not path.is_file():
                    message = "Local Three.js file missing; run npm ci" if self.path.startswith("/vendor/") else "Viewer asset not available"
                    self._reply(404,{"error":message})
                else:
                    self._reply(200,path.read_bytes(),mime)
            else:
                self._reply(404,{"error":"Route not found"})
        except Exception:
            self._reply(500,{"error":"Could not load viewer resource"})

    def do_POST(self):
        if not self._trusted():
            return
        if self.path != "/api/rebuild":
            self._reply(404,{"error":"Route not found"})
            return
        if self.headers.get("Transfer-Encoding") is not None:
            self._reply(400,{"error":"Transfer encoding is not supported; send Content-Length"})
            return
        lengths = self.headers.get_all("Content-Length",[])
        if len(lengths)!=1 or not lengths[0].isascii() or not lengths[0].isdigit() or len(lengths[0])>10:
            self._reply(400,{"error":"A valid nonnegative Content-Length is required"})
            return
        size = int(lengths[0])
        if size>MAX_BODY:
            self._reply(413,{"error":"Request body exceeds 64 KiB"})
            return
        if len(self.headers.get_all("Content-Type",[]))!=1 or self.headers.get_content_type()!="application/json":
            self._reply(415,{"error":"Content-Type must be application/json"})
            return
        try:
            body = self.rfile.read(size)
            if len(body)!=size:
                raise ValueError("Incomplete request body")
            payload = json.loads(body.decode("utf-8"),parse_constant=_reject_constant)
        except (ValueError,TypeError,OverflowError,RecursionError):
            self._reply(400,{"error":"Invalid JSON; use UTF-8 and finite numbers"})
            return
        except (socket.timeout,TimeoutError):
            self._reply(400,{"error":"Request body timed out"})
            return
        except Exception:
            self._reply(500,{"error":"Could not read request"})
            return
        try:
            state = build_state(payload)
        except InvalidModel as error:
            self._reply(422,{"error":str(error),"reports":error.reports})
        except ValueError as error:
            # Geometry validators describe known fields/constraints, not file
            # paths or raw request content. Keep those useful corrections.
            self._reply(400,{"error":str(error)})
        except (TypeError,KeyError,OverflowError,RecursionError):
            self._reply(400,{"error":"Invalid input values; use the current top/bottom formats"})
        except Exception:
            self._reply(500,{"error":"Could not rebuild geometry"})
        else:
            self._reply(200,state)


def make_server(port=0):
    server = ThreadingHTTPServer(("127.0.0.1",port),ViewerHandler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port",type=int,default=8765)
    args = parser.parse_args()
    if not 1<=args.port<=65535:
        parser.error("port must be between 1 and 65535")
    with make_server(args.port) as server:
        print(f"Guide viewer: http://127.0.0.1:{server.server_port}",flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
