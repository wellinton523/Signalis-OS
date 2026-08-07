import os
import json
import mimetypes
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote

ROOT = Path(__file__).resolve().parent
PORT = int(os.getenv("PORT", "8000"))

# ── Configuração do provider LLM ──────────────────────────────
# Opções: "ollama", "openrouter", "groq", "openai"
# Configure via variável de ambiente, NUNCA coloque a chave no código.
#
# Como configurar no terminal antes de rodar:
#   Windows:  set LLM_PROVIDER=openrouter && set LLM_API_KEY=sk-...
#   Linux:    export LLM_PROVIDER=openrouter LLM_API_KEY=sk-...
#   Codespace: vá em Settings → Secrets e adicione LLM_API_KEY
#
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()
API_KEY      = os.getenv("LLM_API_KEY", "")   # ← variável de ambiente, nunca hardcoded

OLLAMA_HOST  = os.getenv("OLLAMA_HOST", "127.0.0.1")
OLLAMA_PORT  = int(os.getenv("OLLAMA_PORT", "11434"))

# URLs de cada provider
PROVIDER_URLS = {
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
    "groq":       "https://api.groq.com/openai/v1/chat/completions",
    "openai":     "https://api.openai.com/v1/chat/completions",
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Silencia logs de acesso pra não poluir o terminal durante uso
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

    # ── Proxy LLM ─────────────────────────────────────────────
    def _proxy_to_llm(self, parsed):
        length = self.headers.get("Content-Length")
        body   = self.rfile.read(int(length)) if length else b""

        # Para providers cloud precisamos adaptar o body
        # porque o Ollama usa um formato ligeiramente diferente do OpenAI
        if LLM_PROVIDER in PROVIDER_URLS:
            target_url   = PROVIDER_URLS[LLM_PROVIDER]
            adapted_body = self._adapt_body_for_openai(body)
            headers      = {
                "Content-Type":  "application/json",
                "Authorization": f"Bearer {API_KEY}",
            }
            # OpenRouter exige este header para identificar o app
            if LLM_PROVIDER == "openrouter":
                headers["HTTP-Referer"] = "https://signalis-os.local"
                headers["X-Title"]      = "SIGNALIS-OS"
        else:
            # Ollama local — repassa o body sem alterar
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
            with urllib.request.urlopen(req, timeout=60) as resp:
                resp_body = resp.read()

                # Para providers cloud, converte a resposta de volta
                # para o formato que o agent.js espera (formato Ollama)
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
        """
        O agent.js envia o body no formato Ollama:
          { model, messages, stream, format }
        
        Os providers OpenAI-compatíveis esperam:
          { model, messages, stream, response_format }
        
        Esta função faz a conversão.
        """
        try:
            data = json.loads(raw_body)
        except Exception:
            return raw_body  # se não for JSON válido, passa como está

        # Ollama usa "format": "json" → OpenAI usa "response_format": {"type": "json_object"}
        if data.get("format") == "json":
            data.pop("format", None)
            data["response_format"] = {"type": "json_object"}

        # Remove campos exclusivos do Ollama que providers cloud não entendem
        data.pop("options", None)
        data.pop("keep_alive", None)

        return json.dumps(data).encode("utf-8")

    def _adapt_response_to_ollama(self, raw_body: bytes) -> bytes:
        """
        Providers cloud respondem no formato OpenAI:
          { choices: [{ message: { role, content } }] }
        
        O agent.js espera o formato Ollama:
          { message: { role, content } }
        
        Esta função faz a conversão.
        """
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
            return raw_body  # se falhar, devolve original

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
    print(f"║  URL    : http://127.0.0.1:{PORT:<5}      ║")
    print(f"║  LLM    : {LLM_PROVIDER.upper():<28} ║")
    print(f"║  API KEY: {'configurada' if API_KEY else 'NÃO CONFIGURADA':<28} ║")
    print(f"╚══════════════════════════════════════╝")

    if LLM_PROVIDER in PROVIDER_URLS and not API_KEY:
        print(f"\n[AVISO] Provider '{LLM_PROVIDER}' selecionado mas LLM_API_KEY não está definida.")
        print(f"        Configure via: export LLM_API_KEY=sua-chave-aqui\n")

    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
