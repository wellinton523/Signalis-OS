import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("signalis_server", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
server.REMOTE_ACCESS_ENABLED = True


class FakeHandler(server.Handler):
    def __init__(self, body):
        self._body = json.dumps(body).encode("utf-8")
        self.sent = None

    def _read_json_body(self):
        return json.loads(self._body)

    def _send_json(self, data, extra_headers=None):
        self.sent = ("json", 200, data)

    def _send_error(self, code, message):
        self.sent = ("error", code, message)


class FakeParsed:
    def __init__(self, path):
        self.path = path


def run(body):
    h = FakeHandler(body)
    h._handle_code_run(FakeParsed("/api/code/run"))
    return h.sent


failures = []


def check(label, cond, detail=""):
    print(f"[{'OK ' if cond else 'FALHOU'}] {label} {detail if not cond else ''}")
    if not cond:
        failures.append(label)


# 1) roda arquivo .py existente
script_path = "/tmp/signalis_test_script.py"
Path(script_path).write_text("print('ola do arquivo')\nimport sys\nsys.exit(0)\n")
kind, code, data = run({"path": script_path})
check("code.run executa arquivo .py existente", kind == "json" and data.get("ok") is True, f"-> {kind} {code} {data}")
check("code.run captura stdout do arquivo", "ola do arquivo" in data.get("stdout", ""), f"-> {data}")

# 2) roda snippet inline python
kind, code, data = run({"code": "print(2 + 2)", "language": "python"})
check("code.run executa snippet inline python", kind == "json" and data.get("ok") is True)
check("code.run snippet stdout correto", data.get("stdout", "").strip() == "4", f"-> {data}")

# 3) roda snippet com erro — exitCode != 0, mas request não deve crashar
kind, code, data = run({"code": "import sys\nsys.exit(3)", "language": "python"})
check("code.run trata exit code != 0 sem crashar", kind == "json" and data.get("ok") is False and data.get("exitCode") == 3, f"-> {data}")

# 4) language inválida -> erro 400 tratado
kind, code, data = run({"code": "puts 1", "language": "ruby"})
check("code.run rejeita language não suportada (400)", kind == "error" and code == 400, f"-> {kind} {code} {data}")

# 5) nem path nem code -> erro 400
kind, code, data = run({})
check("code.run exige path ou code (400)", kind == "error" and code == 400)

# 6) extensão não suportada
Path("/tmp/signalis_test.exe").write_bytes(b"")
kind, code, data = run({"path": "/tmp/signalis_test.exe"})
check("code.run rejeita extensão não suportada (400)", kind == "error" and code == 400, f"-> {kind} {code} {data}")

print()
if failures:
    print(f"FALHAS: {failures}")
    sys.exit(1)
print("TODOS OS TESTES DE code.run PASSARAM")
