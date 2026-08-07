import os
import json
import mimetypes
import urllib.request
import urllib.error
import time
import platform
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote

# Tenta importar psutil para métricas precisas. Se não estiver instalado, usa fallbacks.
try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

ROOT = Path(__file__).resolve().parent
PORT = int(os.getenv("PORT", "8000"))

# ── Configuração do provider LLM ──────────────────────────────
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()
API_KEY      = os.getenv("LLM_API_KEY", "")

OLLAMA_HOST  = os.getenv("OLLAMA_HOST", "127.0.0.1")
OLLAMA_PORT  = int(os.getenv("OLLAMA_PORT", "11434"))

PROVIDER_URLS = {
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
    "groq":       "https://api.groq.com/openai/v1/chat/completions",
    "openai":     "https://api.openai.com/v1/chat/completions",
}

# Variáveis globais para cálculo de uso de CPU (Fallback sem psutil)
_last_cpu_idle = 0
_last_cpu_total = 0


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):    self._handle_request()
    def do_POST(self):   self._handle_request()
    def do_OPTIONS(self):
        self._send_response(204, b"", {
            "Access-Control-Allow-Origin":  "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        })

    def _handle_request(self):
        parsed = urlparse(self.path)

        # ── Rotas do Monitor de Sistema (SysMon) ──────────────
        if parsed.path == "/api/system/info":
            self._handle_sys_info()
            return

        if parsed.path == "/api/system/cpu":
            self._handle_sys_cpu()
            return

        if parsed.path == "/api/system/disk":
            self._handle_sys_disk()
            return

        # ── Proxies Existentes ────────────────────────────────
        if parsed.path.startswith("/api/ollama"):
            self._proxy_to_llm(parsed)
            return

        if parsed.path.startswith("/api/search/duckduckgo"):
            self._proxy_to_duckduckgo(parsed)
            return

        # Servidor de arquivos estáticos
        target_path = parsed.path.lstrip("/") or "index.html"
        if target_path.endswith("/"):
            target_path += "index.html"

        local_path = (ROOT / target_path).resolve()
        if not str(local_path).startswith(str(ROOT)):
            self._send_error(403, "Acesso negado")
            return

        if local_path.is_dir():
            local_path = local_path / "index.html"

        if not local_path.exists() or not local_path.is_file():
            self._send_error(404, "Arquivo não encontrado")
            return

        data      = local_path.read_bytes()
        mime_type = mimetypes.guess_type(str(local_path))[0] or "application/octet-stream"
        self._send_response(200, data, {
            "Content-Type":    mime_type,
            "Cache-Control":   "no-store",
            "Access-Control-Allow-Origin": "*",
        })

    # ── Endpoints do SysMon ───────────────────────────────────
    def _handle_sys_info(self):
        global HAS_PSUTIL
        if HAS_PSUTIL:
            mem = psutil.virtual_memory()
            total_ram = mem.total
            free_ram = mem.available
            cpu_cores = psutil.cpu_count(logical=True)
            uptime = int(time.time() - psutil.boot_time())
        else:
            # Fallback usando a biblioteca padrão
            total_ram = 8 * 1024 * 1024 * 1024  # 8GB Padrão se não conseguir ler
            free_ram = 4 * 1024 * 1024 * 1024
            cpu_cores = os.cpu_count() or 4
            uptime = 0

            if hasattr(os, 'sysconf'):
                if 'SC_PAGE_SIZE' in os.sysconf_names and 'SC_PHYS_PAGES' in os.sysconf_names:
                    total_ram = os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES')
                if 'SC_AVPHYS_PAGES' in os.sysconf_names:
                    free_ram = os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_AVPHYS_PAGES')

            try:
                with open('/proc/uptime', 'r') as f:
                    uptime = int(float(f.readline().split()[0]))
            except Exception:
                pass

        data = {
            "hostname": platform.node(),
            "cpuModel": platform.processor() or f"{platform.machine()} Processor",
            "cpuCores": cpu_cores,
            "uptime": uptime,
            "totalRam": total_ram,
            "freeRam": free_ram
        }
        self._send_json(data)

    def _handle_sys_cpu(self):
        global HAS_PSUTIL, _last_cpu_idle, _last_cpu_total
        usage = 0.0

        if HAS_PSUTIL:
            usage = psutil.cpu_percent(interval=None)
        else:
            # Fallback para Linux via /proc/stat
            try:
                with open('/proc/stat', 'r') as f:
                    fields = [float(x) for x in f.readline().split()[1:]]
                    idle = fields[3] + fields[4]
                    total = sum(fields)
                    
                    diff_idle = idle - _last_cpu_idle
                    diff_total = total - _last_cpu_total
                    
                    if diff_total > 0:
                        usage = round((1.0 - diff_idle / diff_total) * 100, 1)
                    
                    _last_cpu_idle = idle
                    _last_cpu_total = total
            except Exception:
                usage = 0.0

        self._send_json({"usage": usage})

    def _handle_sys_disk(self):
        global HAS_PSUTIL
        total, used, free = 0, 0, 0

        if HAS_PSUTIL:
            disk = psutil.disk_usage('/')
            total, used, free = disk.total, disk.used, disk.free
        else:
            try:
                st = os.statvfs('/')
                total = st.f_blocks * st.f_frsize
                free = st.f_bavail * st.f_frsize
                used = total - free
            except Exception:
                pass

        self._send_json({"total": total, "used": used, "free": free})

    def _send_json(self, data):
        body = json.dumps(data).encode("utf-8")
        self._send_response(200, body, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        })

    # ── Proxy LLM ─────────────────────────────────────────────
    def _proxy_to_llm(self, parsed):
        length = self.headers.get("Content-Length")
        body   = self.rfile.read(int(length)) if length else b""

        if LLM_PROVIDER in PROVIDER_URLS:
            target_url   = PROVIDER_URLS[LLM_PROVIDER]
            adapted_body = self._adapt_body_for_openai(body)
            headers      = {
                "Content-Type":  "application/json",
                "Authorization": f"Bearer {API_KEY}",
            }
            if LLM_PROVIDER == "openrouter":
                headers["HTTP-Referer"] = "https://signalis-os.local"
                headers["X-Title"]      = "SIGNALIS-OS"
        else:
            adapted_body = body
            target_path  = parsed.path.replace("/api/ollama", "/api", 1) or "/"
            target_url   = f"http://{OLLAMA_HOST}:{OLLAMA_PORT}{target_path}"
            if parsed.query:
                target_url += f"?{parsed.query}"
            headers = {"Content-Type": "application/json"}

        req = urllib.request.Request(
            target_url, data=adapted_body, headers=headers, method=self.command
        )
        try:
            with urllib.request.urlopen(req, timeout=None) as resp:
                resp_body = resp.read()

                if LLM_PROVIDER in PROVIDER_URLS:
                    resp_body = self._adapt_response_to_ollama(resp_body)

                self._send_response(resp.getcode(), resp_body, {
                    "Content-Type":  "application/json",
                    "Access-Control-Allow-Origin": "*",
                })
        except urllib.error.HTTPError as exc:
            self._send_response(exc.code, exc.read(), {
                "Content-Type":  "application/json",
                "Access-Control-Allow-Origin": "*",
            })
        except Exception as exc:
            self._send_error(502, f"Falha ao contactar o provider LLM ({LLM_PROVIDER}): {exc}")

    def _adapt_body_for_openai(self, raw_body: bytes) -> bytes:
        try:
            data = json.loads(raw_body)
        except Exception:
            return raw_body

        if data.get("format") == "json":
            data.pop("format", None)
            data["response_format"] = {"type": "json_object"}

        data.pop("options", None)
        data.pop("keep_alive", None)

        return json.dumps(data).encode("utf-8")

    def _adapt_response_to_ollama(self, raw_body: bytes) -> bytes:
        try:
            data    = json.loads(raw_body)
            choices = data.get("choices", [])
            message = choices[0].get("message", {}) if choices else {}
            ollama_fmt = {
                "model":   data.get("model", ""),
                "message": message,
                "done":    True,
            }
            return json.dumps(ollama_fmt).encode("utf-8")
        except Exception:
            return raw_body

    # ── Proxy DuckDuckGo ───────────────────────────────────────
    def _proxy_to_duckduckgo(self, parsed):
        params    = parse_qs(parsed.query)
        query     = params.get("q", [""])[0]
        target    = f"https://html.duckduckgo.com/html/?q={quote(query)}"
        browser_h = {
            "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        }
        try:
            req = urllib.request.Request(target, headers=browser_h)
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = resp.read()
                self._send_response(resp.getcode(), body, {
                    "Content-Type":  resp.headers.get("Content-Type", "text/html; charset=utf-8"),
                    "Access-Control-Allow-Origin": "*",
                })
        except Exception as exc:
            self._send_error(502, f"Falha ao contactar o DuckDuckGo: {exc}")

    # ── Helpers ───────────────────────────────────────────────
    def _send_response(self, status, body, headers=None):
        self.send_response(status)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _send_error(self, status, message):
        self._send_response(status, message.encode("utf-8"), {
            "Content-Type":  "text/plain; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
        })


if __name__ == "__main__":
    print(f"╔══════════════════════════════════════╗")
    print(f"║  SIGNALIS-OS // SERVIDOR             ║")
    print(f"╠══════════════════════════════════════╣")
    print(f"║  PORTA LOCAL : {PORT:<21} ║")
    print(f"║  LLM PROVIDER: {LLM_PROVIDER.upper():<21} ║")

    # ── Abertura de Túnel Público Automático ──
    try:
        from pyngrok import ngrok, conf
        conf.get_default().auth_token = "3HaTLV9pkMByvDXlYsrFqoJJG1j_6ixupoASXfN8abZyiExRi"
        # Abre o túnel público apontando para a porta do servidor
        public_tunnel = ngrok.connect(PORT)
        print(f"║  URL PÚBLICA : {public_tunnel.public_url:<21} ║")
    except ImportError:
        print(f"║  TUNNEL      : pyngrok não instalado  ║")
    except Exception as e:
        print(f"║  TUNNEL ERRO : {str(e)[:21]:<21} ║")

    print(f"╚══════════════════════════════════════╝\n")

    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()