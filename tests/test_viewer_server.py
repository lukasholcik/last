import copy
import http.client
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch

from bottom_profile import bottom_curve_points
from last_shape import curve_points, bezier
from contour_last import build_contour_last
from viewer_server import (InvalidModel, MAX_BODY, build_state, load_defaults,
                           make_server)


class StateTests(unittest.TestCase):
    def test_baseline_uses_existing_models_reports_and_exact_samples(self):
        inputs = load_defaults()
        before = copy.deepcopy(inputs)
        with patch.object(Path,"write_text",side_effect=AssertionError("unexpected write")), \
                patch.object(Path,"write_bytes",side_effect=AssertionError("unexpected write")):
            state = build_state(inputs)
        top,bottom = state["models"]["top"],state["models"]["bottom"]
        core=build_contour_last(inputs)
        self.assertEqual(state["models"],core["models"])
        self.assertEqual(state["reports"],core["reports"])
        self.assertEqual(set(state["reports"]),{"top","bottom","contour"})
        self.assertNotIn("projected_inputs",state)
        for kind,model,names,extract in (("top",top,top["outline"],curve_points),
                                         ("bottom",bottom,bottom["profile"],bottom_curve_points)):
            self.assertEqual([c["name"] for c in state["display"][kind]],names)
            for displayed,name in zip(state["display"][kind],names):
                self.assertEqual(len(displayed["points"]),65)
                for i,p in enumerate(displayed["points"]):
                    a,b = bezier(extract(model,name),i/64)
                    self.assertEqual(p,[a,b,0] if kind=="top" else [0,a,b])
        self.assertEqual(inputs,before)
        state["inputs"]["design"]["last_length"] = 1
        self.assertEqual(inputs,before)

    def test_numeric_edits_have_only_existing_dependencies(self):
        inputs = load_defaults()
        baseline = build_state(inputs)
        top_edit = copy.deepcopy(inputs)
        top_edit["design"]["top"]["lateral_ball_width"] += 6
        state = build_state(top_edit)
        self.assertNotEqual(state["models"]["top"],baseline["models"]["top"])
        self.assertEqual(state["models"]["bottom"],baseline["models"]["bottom"])
        bottom_edit = copy.deepcopy(inputs)
        bottom_edit["design"]["bottom"]["heel_height"] = 12
        state = build_state(bottom_edit)
        self.assertNotEqual(state["models"]["top"],baseline["models"]["top"])
        self.assertEqual(state["inputs"]["design"]["top"],inputs["design"]["top"])
        self.assertNotEqual(state["models"]["bottom"],baseline["models"]["bottom"])
        shared = copy.deepcopy(inputs)
        shared["design"]["last_length"] = 260
        state = build_state(shared)
        self.assertNotEqual(state["models"]["top"],baseline["models"]["top"])
        self.assertNotEqual(state["models"]["bottom"],baseline["models"]["bottom"])
        self.assertEqual(build_state(inputs),baseline)

    def test_defaults_are_fresh_and_independent_of_cwd(self):
        defaults = load_defaults()
        defaults["design"]["bottom"]["heel_height"] = 999
        with patch("os.getcwd",return_value="/not/the/project"):
            self.assertEqual(load_defaults()["design"]["bottom"]["heel_height"],8)

    def test_failed_validation_raises_without_models(self):
        core=build_contour_last(load_defaults())
        core["reports"]["contour"]["passed"]=False
        with patch("viewer_server.build_contour_last",return_value=core):
            with self.assertRaises(InvalidModel) as result:
                build_state(load_defaults())
        self.assertFalse(result.exception.reports["contour"]["passed"])


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = make_server()
        cls.thread = threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request(self,method,path,body=None,headers=None):
        connection = http.client.HTTPConnection("127.0.0.1",self.port,timeout=10)
        self.addCleanup(connection.close)
        connection.request(method,path,body,headers or {})
        response = connection.getresponse()
        data = response.read()
        self.assertEqual(response.getheader("Cache-Control"),"no-store")
        self.assertEqual(response.getheader("X-Content-Type-Options"),"nosniff")
        self.assertEqual(int(response.getheader("Content-Length")),len(data))
        return response,data

    def post(self,payload):
        return self.request("POST","/api/rebuild",json.dumps(payload),{"Content-Type":"application/json"})

    def test_defaults_rebuild_then_invalid_then_valid(self):
        response,data = self.request("GET","/api/defaults")
        self.assertEqual(response.status,200)
        defaults = json.loads(data)
        response,data = self.post(defaults)
        self.assertEqual(response.status,200)
        baseline = json.loads(data)
        self.assertTrue(all(r["passed"] for r in baseline["reports"].values()))
        invalid = copy.deepcopy(defaults)
        invalid["design"]["bottom"]["blend_arc_length"] = 0
        response,data = self.post(invalid)
        self.assertEqual(response.status,400)
        self.assertNotIn("models",json.loads(data))
        response,data = self.post(defaults)
        self.assertEqual(response.status,200)
        self.assertEqual(json.loads(data),baseline)

    def test_unknown_and_source_paths_are_not_exposed(self):
        for path in ("/viewer_server.py","/README.md","/examples/baseline.json","/node_modules/three/package.json",
                     "/../README.md","/%2e%2e/README.md","/?source=1","/api/defaults?x=1","/web/"):
            with self.subTest(path=path):
                response,data = self.request("GET",path)
                self.assertEqual(response.status,404)
                self.assertIn("error",json.loads(data))
        response,_ = self.request("POST","/api/unknown",b"{}")
        self.assertEqual(response.status,404)

    def test_old_projected_payload_is_rejected_without_migration_or_writes(self):
        response,data=self.post({"top":{},"bottom":{}})
        self.assertEqual(response.status,400)
        self.assertIn("Obsolete projected",json.loads(data)["error"])
        payload=load_defaults()
        payload["filename"]="examples/contour-baseline.json"
        with patch.object(Path,"write_text",side_effect=AssertionError("unexpected write")), \
                patch.object(Path,"write_bytes",side_effect=AssertionError("unexpected write")):
            response,data=self.post(payload)
        self.assertEqual(response.status,400)
        response,data=self.request("GET","/api/defaults")
        self.assertEqual(json.loads(data),load_defaults())

    def test_input_types_nonfinite_and_deep_json(self):
        payloads = [None,[],{},dict(top={},bottom=[],extra=1)]
        for value in (True,10**400):
            payload = load_defaults()
            payload["design"]["last_length"] = value
            payloads.append(payload)
        for payload in payloads:
            response,data = self.post(payload)
            self.assertEqual(response.status,400)
            self.assertIn("error",json.loads(data))
        for body in (b"{",b'{"top": NaN, "bottom": {}}',b'{"top": Infinity,"bottom":{}}',
                     b'{"top":1e999,"bottom":{}}',b"["*1500+b"0"+b"]"*1500,b"\xff"):
            response,data = self.request("POST","/api/rebuild",body,{"Content-Type":"application/json"})
            self.assertEqual(response.status,400)
            self.assertNotIn("Traceback",data.decode())
        payload = load_defaults()
        payload["description"] = float("nan")
        response,_ = self.post(payload)
        self.assertEqual(response.status,400)

    def test_content_type_size_and_origin_host(self):
        response,_ = self.request("POST","/api/rebuild",b"{}",{"Content-Type":"text/plain"})
        self.assertEqual(response.status,415)
        response,_ = self.request("POST","/api/rebuild",b"x"*(MAX_BODY+1),{"Content-Type":"application/json"})
        self.assertEqual(response.status,413)
        for headers in ({"Host":"foreign.invalid"},{"Host":"127.0.0.1:1"},
                        {"Origin":"https://evil.invalid"},{"Origin":"null"}):
            response,_ = self.request("GET","/api/defaults",headers=headers)
            self.assertEqual(response.status,403)
        response,_ = self.request("GET","/api/defaults",headers={"Host":f"localhost:{self.port}","Origin":f"http://127.0.0.1:{self.port}"})
        self.assertEqual(response.status,200)
        self.assertEqual(self.server.server_address[0],"127.0.0.1")

    def test_validation_reasons_are_readable_but_parse_errors_are_generic(self):
        cases = (("contact_s",290,"contact_s"),
                 ("seat_inclination_deg",50,"seat front: B"))
        for field,value,reason in cases:
            payload = load_defaults()
            payload["design"]["bottom"][field] = value
            response,data = self.post(payload)
            self.assertEqual(response.status,400)
            self.assertIn(reason,json.loads(data)["error"])
        payload = load_defaults()
        payload["schema_version"] = 2
        response,data = self.post(payload)
        self.assertEqual(response.status,400)
        self.assertIn("schema_version 1",json.loads(data)["error"])
        for body in (b'{"private_payload":',b'\xff',b'{"top":NaN}',b'{"top":Infinity}',b'9'*5000):
            response,data = self.request("POST","/api/rebuild",body,{"Content-Type":"application/json"})
            self.assertEqual(response.status,400)
            self.assertEqual(json.loads(data)["error"],"Invalid JSON; use UTF-8 and finite numbers")
            self.assertNotIn("private_payload",data.decode())
        payload = load_defaults()
        payload["design"]["last_length"] = 10**400
        response,data = self.post(payload)
        self.assertEqual(response.status,400)
        self.assertIn("last_length must be finite",json.loads(data)["error"])
        self.assertLess(len(data),300)

    def test_failed_actual_report_is_422_and_unexpected_error_is_generic(self):
        for name in ("top","bottom","contour"):
            core=build_contour_last(load_defaults())
            core["reports"][name]["passed"]=False
            with patch("viewer_server.build_contour_last",return_value=core):
                response,data = self.post(load_defaults())
            self.assertEqual(response.status,422)
            self.assertFalse(json.loads(data)["reports"][name]["passed"])
            self.assertNotIn("models",json.loads(data))
        with patch("viewer_server.build_contour_last",side_effect=RuntimeError("secret /private/example")):
            response,data = self.post(load_defaults())
        self.assertEqual(response.status,500)
        self.assertNotIn("secret",data.decode())
        response,_ = self.post(load_defaults())
        self.assertEqual(response.status,200)
        with patch("viewer_server.load_defaults",side_effect=RuntimeError("secret /private/example")):
            response,data = self.request("GET","/api/defaults")
        self.assertEqual(response.status,500)
        self.assertNotIn("secret",data.decode())

    def test_static_allowlist_mimes_with_no_installed_node_modules(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("index.html","styles.css","app.js","scene.js"):
                (root/"web").mkdir(exist_ok=True)
                (root/"web"/name).write_text("test asset")
            with patch("viewer_server.ROOT",root):
                for path,mime in (("/","text/html"),("/index.html","text/html"),("/app.js","text/javascript"),
                                  ("/scene.js","text/javascript"),("/styles.css","text/css")):
                    response,data = self.request("GET",path)
                    self.assertEqual(response.status,200)
                    self.assertTrue(response.getheader("Content-Type").startswith(mime))
                    self.assertEqual(data,b"test asset")
                response,data = self.request("GET","/vendor/three/build/three.module.js")
                self.assertEqual(response.status,404)
                self.assertIn("npm ci",json.loads(data)["error"])
                fixtures = {
                    "build/three.module.js": "export { fixture } from './three.core.js';",
                    "build/three.core.js": "export const fixture = true;",
                    "examples/jsm/controls/OrbitControls.js": "import { fixture } from 'three';",
                }
                for relative,content in fixtures.items():
                    path = root/"node_modules/three"/relative
                    path.parent.mkdir(parents=True,exist_ok=True)
                    path.write_text(content)
                for relative,content in fixtures.items():
                    response,data = self.request("GET","/vendor/three/"+relative)
                    self.assertEqual(response.status,200)
                    self.assertTrue(response.getheader("Content-Type").startswith("text/javascript"))
                    self.assertEqual(data.decode(),content)

    def test_bad_lengths_transfer_encoding_and_incomplete_body(self):
        headers = ([],["Content-Length: -1"],["Content-Length: nope"],
                   ["Content-Length: 2","Content-Length: 2"],
                   ["Transfer-Encoding: chunked"],["Content-Length: 10"])
        for extra in headers:
            with self.subTest(headers=extra):
                sock = socket.create_connection(("127.0.0.1",self.port),timeout=5)
                with sock:
                    request = "\r\n".join(["POST /api/rebuild HTTP/1.1",f"Host: 127.0.0.1:{self.port}",
                                             "Content-Type: application/json",*extra,"",""])
                    sock.sendall(request.encode())
                    sock.shutdown(socket.SHUT_WR)
                    response = http.client.HTTPResponse(sock)
                    response.begin()
                    self.assertEqual(response.status,400)
                    self.assertIn("error",json.loads(response.read()))


if __name__ == "__main__":
    unittest.main()
