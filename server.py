import os
import json
import mimetypes
import urllib.request
import urllib.error
import time
import platform
import subprocess
import shutil
import webbrowser
import secrets
import base64
import asyncio
import io
import socket
import ipaddress
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote, urlencode

# Carrega .env do diretório raiz (se python-dotenv estiver disponível)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

# Tenta importar psutil para métricas precisas. Se não estiver instalado, usa fallbacks.
try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

# Integrações de voz (Whisper STT + OpenAI TTS)
# Suporta os DOIS backends em paralelo:
#   - emergentintegrations (Emergent LLM key, funciona só dentro do Emergent)
#   - openai (biblioteca pública, usa OPENAI_API_KEY)
# O servidor tenta emergent primeiro se EMERGENT_LLM_KEY estiver setada;
# senão usa openai se OPENAI_API_KEY estiver setada.
_HAS_EMERGENT = False
_HAS_OPENAI   = False
try:
    from emergentintegrations.llm.openai import OpenAISpeechToText, OpenAITextToSpeech
    _HAS_EMERGENT = True
except ImportError:
    pass
try:
    from openai import OpenAI as _OpenAIClient
    _HAS_OPENAI = True
except ImportError:
    pass
HAS_VOICE = _HAS_EMERGENT or _HAS_OPENAI

def _pick_voice_backend():
    """Retorna (backend, api_key) — 'emergent'|'openai'|None."""
    em_key = os.getenv("EMERGENT_LLM_KEY", "").strip()
    oa_key = os.getenv("OPENAI_API_KEY",   "").strip()
    if _HAS_EMERGENT and em_key:
        return "emergent", em_key
    if _HAS_OPENAI and oa_key:
        return "openai", oa_key
    return None, ""

def _voice_setup_hint():
    """Mensagem de erro específica dizendo o que instalar/configurar."""
    parts = []
    if not (_HAS_EMERGENT or _HAS_OPENAI):
        parts.append("Instale a lib de voz: 'pip install openai' (recomendado) OU 'pip install emergentintegrations --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/'.")
    em_key = os.getenv("EMERGENT_LLM_KEY", "").strip()
    oa_key = os.getenv("OPENAI_API_KEY",   "").strip()
    if not em_key and not oa_key:
        parts.append("Configure OPENAI_API_KEY no /app/.env (crie em https://platform.openai.com/api-keys) OU EMERGENT_LLM_KEY (se rodando dentro do Emergent).")
    elif _HAS_EMERGENT and not _HAS_OPENAI and not em_key:
        parts.append("Você tem emergentintegrations instalado mas EMERGENT_LLM_KEY não está setada. Rode 'pip install openai' e configure OPENAI_API_KEY, OU exporte EMERGENT_LLM_KEY no .env.")
    elif _HAS_OPENAI and not _HAS_EMERGENT and not oa_key:
        parts.append("Você tem openai instalado mas OPENAI_API_KEY não está setada no .env.")
    return " ".join(parts) if parts else "Serviço de voz indisponível."

# Redige mensagens de erro do provedor para nunca vazar chave/segredo.
def _sanitize_provider_error(msg):
    s = str(msg or "")[:200]
    # Remove qualquer coisa que pareça um bearer/api key
    import re
    s = re.sub(r"sk-[A-Za-z0-9_\-]{6,}",     "sk-***REDACTED***",     s)
    s = re.sub(r"Bearer\s+[A-Za-z0-9_\-\.]+", "Bearer ***REDACTED***", s, flags=re.IGNORECASE)
    return s

ROOT = Path(__file__).resolve().parent
PORT = int(os.getenv("PORT", "8000"))

# ── Configuração do provider LLM ──────────────────────────────
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()
API_KEY      = os.getenv("LLM_API_KEY", "")

# ── Spotify ────────────────────────────────────────────────────
SPOTIFY_CLIENT_ID     = os.getenv("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET", "")
_spotify_token_cache  = {"access_token": None, "expires_at": 0}

OLLAMA_HOST  = os.getenv("OLLAMA_HOST", "127.0.0.1")
OLLAMA_PORT  = int(os.getenv("OLLAMA_PORT", "11434"))
AUTH_USERNAME = os.getenv("SIGNALIS_USERNAME", "Nyx")
AUTH_PASSWORD = os.getenv("SIGNALIS_PASSWORD", "84269713")

# Usuários com permissão máxima (GOD) ao autenticar
GOD_USERS = {u.strip().lower() for u in os.getenv("SIGNALIS_GOD_USERS", "Nyx").split(",") if u.strip()}
NGROK_AUTHTOKEN = os.getenv("NGROK_AUTHTOKEN", "3HaTLV9pkMByvDXlYsrFqoJJG1j_6ixupoASXfN8abZyiExRi")
SESSION_TTL = 8 * 60 * 60
SESSIONS = {}
REMOTE_ACCESS_ENABLED = False

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

        if parsed.path.startswith("/api/auth/"):
            self._handle_auth(parsed)
            return

        if parsed.path.startswith("/api/") and not self._is_authenticated():
            self._send_error(401, "Autenticação necessária.")
            return

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

        if parsed.path == "/api/tools":
            self._handle_tool_manifest()
            return

        if parsed.path == "/api/voice/stt":
            self._handle_voice_stt()
            return

        if parsed.path == "/api/voice/tts":
            self._handle_voice_tts()
            return

        if parsed.path.startswith("/api/fs/"):
            self._handle_filesystem_api(parsed)
            return

        if parsed.path == "/api/system/processes":
            self._handle_process_list()
            return

        if parsed.path in {"/api/system/kill", "/api/system/exec", "/api/system/open"}:
            self._handle_system_action(parsed)
            return

        if parsed.path.startswith("/api/system/clipboard"):
            self._handle_clipboard(parsed)
            return

        if parsed.path == "/api/system/music":
            self._handle_music()
            return

        if parsed.path.startswith("/api/spotify/"):
            self._handle_spotify(parsed)
            return

        if parsed.path.startswith("/api/browser/"):
            self._handle_browser_api(parsed)
            return

        if parsed.path == "/api/network/request":
            self._handle_network_request(parsed)
            return

        if parsed.path == "/api/code/run":
            self._handle_code_run(parsed)
            return

        if parsed.path.startswith("/api/vscode/"):
            self._handle_vscode(parsed)
            return

        if parsed.path.startswith("/api/git/"):
            self._handle_git(parsed)
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

    def _send_json(self, data, extra_headers=None):
        body = json.dumps(data).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        }
        headers.update(extra_headers or {})
        self._send_response(200, body, headers)

    def _handle_voice_stt(self):
        """POST /api/voice/stt — recebe áudio (webm/wav/mp3) e devolve texto (pt-BR)."""
        backend, key = _pick_voice_backend()
        if not backend:
            self._send_error(503, _voice_setup_hint())
            return

        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 25 * 1024 * 1024:
            self._send_error(400, "Áudio ausente ou maior que 25MB.")
            return

        content_type = self.headers.get("Content-Type", "audio/webm")
        ext = "webm"
        if "wav" in content_type: ext = "wav"
        elif "mp3" in content_type or "mpeg" in content_type: ext = "mp3"
        elif "ogg" in content_type: ext = "ogg"
        elif "m4a" in content_type or "mp4" in content_type: ext = "m4a"

        audio_bytes = self.rfile.read(length)

        try:
            if backend == "emergent":
                async def _do():
                    stt = OpenAISpeechToText(api_key=key)
                    buf = io.BytesIO(audio_bytes); buf.name = f"audio.{ext}"
                    resp = await stt.transcribe(file=buf, model="whisper-1", response_format="json", language="pt")
                    return getattr(resp, "text", str(resp))
                text_out = asyncio.run(_do())
            else:  # openai
                client = _OpenAIClient(api_key=key)
                buf = io.BytesIO(audio_bytes); buf.name = f"audio.{ext}"
                resp = client.audio.transcriptions.create(model="whisper-1", file=buf, response_format="json", language="pt")
                text_out = getattr(resp, "text", str(resp))
            payload = json.dumps({"text": text_out or "", "backend": backend}).encode("utf-8")
            self._send_response(200, payload, {
                "Content-Type": "application/json; charset=utf-8",
                "X-Voice-Backend": backend,
                "Access-Control-Allow-Origin": "*",
            })
        except Exception as e:
            print(f"[voice.stt] erro ({backend}): {e}")
            self._send_error(500, f"Falha na transcrição ({backend}): {_sanitize_provider_error(e)}")

    def _handle_voice_tts(self):
        """POST /api/voice/tts — recebe {text, voice?, model?, speed?} e devolve mp3."""
        backend, key = _pick_voice_backend()
        if not backend:
            self._send_error(503, _voice_setup_hint())
            return

        try:
            body = self._read_json_body()
        except ValueError as e:
            self._send_error(400, str(e))
            return

        text_in = str(body.get("text", "")).strip()
        if not text_in:
            self._send_error(400, "Campo 'text' vazio.")
            return
        if len(text_in) > 4096:
            text_in = text_in[:4090] + "..."

        VALID_VOICES = {"nova", "shimmer", "alloy", "coral", "sage", "onyx", "fable", "echo", "ash"}
        VALID_MODELS = {"tts-1", "tts-1-hd", "gpt-4o-mini-tts"}
        voice = str(body.get("voice", "nova"))
        model = str(body.get("model", "tts-1-hd"))
        if voice not in VALID_VOICES:
            self._send_error(400, f"Voz inválida '{voice}'. Válidas: {', '.join(sorted(VALID_VOICES))}.")
            return
        if model not in VALID_MODELS:
            self._send_error(400, f"Modelo inválido '{model}'. Válidos: {', '.join(sorted(VALID_MODELS))}.")
            return
        try:
            speed = float(body.get("speed", 1.0))
        except (TypeError, ValueError):
            speed = 1.0

        try:
            if backend == "emergent":
                async def _do():
                    tts = OpenAITextToSpeech(api_key=key)
                    return await tts.generate_speech(
                        text=text_in, model=model, voice=voice,
                        speed=speed, response_format="mp3"
                    )
                audio_bytes = asyncio.run(_do())
            else:  # openai
                client = _OpenAIClient(api_key=key)
                resp = client.audio.speech.create(model=model, voice=voice, input=text_in, response_format="mp3", speed=speed)
                audio_bytes = resp.content if hasattr(resp, "content") else resp.read()

            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(audio_bytes)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Voice-Backend", backend)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(audio_bytes)
        except Exception as e:
            print(f"[voice.tts] erro ({backend}): {e}")
            self._send_error(500, f"Falha na síntese ({backend}): {_sanitize_provider_error(e)}")

    def _handle_tool_manifest(self):
        tools_root = ROOT / "js" / "tools"
        tools = []

        if tools_root.exists():
            for file_path in tools_root.rglob("*.js"):
                if file_path.is_file():
                    tools.append(file_path.relative_to(ROOT).as_posix())

        self._send_json({"tools": sorted(tools)})

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("JSON inválido.")

    def _session_token(self):
        cookies = self.headers.get("Cookie", "")
        for item in cookies.split(";"):
            name, _, value = item.strip().partition("=")
            if name == "signalis_session":
                return value
        return None

    def _is_authenticated(self):
        token = self._session_token()
        expires_at = SESSIONS.get(token, 0)
        if expires_at <= time.time():
            SESSIONS.pop(token, None)
            return False
        return True

    def _handle_auth(self, parsed):
        global REMOTE_ACCESS_ENABLED
        try:
            if parsed.path == "/api/auth/status":
                authed = self._is_authenticated()
                self._send_json({
                    "authenticated": authed,
                    "remoteAccessEnabled": REMOTE_ACCESS_ENABLED,
                    "username": AUTH_USERNAME if authed else None,
                    "permissionLevel": "god" if AUTH_USERNAME.lower() in GOD_USERS and authed else "restricted"
                })
                return

            if parsed.path == "/api/auth/login":
                data = self._read_json_body()
                username = str(data.get("username", ""))
                password = str(data.get("password", ""))
                if not AUTH_PASSWORD:
                    self._send_error(503, "SIGNALIS_PASSWORD não foi configurada no servidor.")
                    return
                if not (secrets.compare_digest(username, AUTH_USERNAME) and secrets.compare_digest(password, AUTH_PASSWORD)):
                    self._send_error(401, "Credenciais inválidas.")
                    return
                token = secrets.token_urlsafe(32)
                SESSIONS[token] = time.time() + SESSION_TTL
                perm_level = "god" if username.lower() in GOD_USERS else "restricted"
                self._send_json({
                    "authenticated": True,
                    "remoteAccessEnabled": REMOTE_ACCESS_ENABLED,
                    "username": username,
                    "permissionLevel": perm_level
                }, {
                    "Set-Cookie": f"signalis_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_TTL}"
                })
                return

            if not self._is_authenticated():
                self._send_error(401, "Autenticação necessária.")
                return

            if parsed.path == "/api/auth/logout":
                SESSIONS.pop(self._session_token(), None)
                self._send_json({"authenticated": False}, {"Set-Cookie": "signalis_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})
                return

            if parsed.path == "/api/auth/remote-access":
                data = self._read_json_body()
                REMOTE_ACCESS_ENABLED = bool(data.get("enabled"))
                self._send_json({"remoteAccessEnabled": REMOTE_ACCESS_ENABLED})
                return

            self._send_error(404, "Rota de autenticação desconhecida.")
        except ValueError as exc:
            self._send_error(400, str(exc))

    def _require_remote_access(self):
        if not REMOTE_ACCESS_ENABLED:
            raise PermissionError("Acesso remoto desativado na interface do SIGNALIS-OS.")

    def _local_path(self, value):
        if not isinstance(value, str) or not value.strip():
            raise ValueError("Caminho obrigatório.")
        return Path(value).expanduser().resolve()

    def _handle_filesystem_api(self, parsed):
        try:
            data = self._read_json_body()
            operation = parsed.path.rsplit("/", 1)[-1]
            if operation == "home":
                self._send_json({"path": str(Path.home())})
                return

            self._require_remote_access()

            path = self._local_path(data.get("path"))
            if operation == "rename":
                new_name = str(data.get("newName", "")).strip()
                if not new_name or "/" in new_name or "\\" in new_name:
                    raise ValueError("newName deve ser apenas um nome simples.")
                destination = path.parent / new_name
                if not path.exists():
                    raise FileNotFoundError("Origem não encontrada.")
                path.rename(destination)
                self._send_json({"from": str(path), "to": str(destination)})
                return
            if operation == "duplicates":
                recursive = bool(data.get("recursive", True))
                if not path.is_dir():
                    raise FileNotFoundError("Pasta não encontrada.")
                size_map = {}
                glob_fn = path.rglob if recursive else path.glob
                for entry in glob_fn("*"):
                    if entry.is_file():
                        key = (entry.name.lower(), entry.stat().st_size)
                        size_map.setdefault(key, []).append(str(entry))
                duplicates = [
                    {"name": k[0], "size": k[1], "paths": v}
                    for k, v in size_map.items() if len(v) > 1
                ]
                self._send_json({"path": str(path), "duplicates": duplicates, "count": len(duplicates)})
                return
            if operation == "organize":
                dry_run = bool(data.get("dryRun", False))
                if not path.is_dir():
                    raise FileNotFoundError("Pasta não encontrada.")
                EXT_MAP = {
                    "imagens":    {".jpg",".jpeg",".png",".gif",".webp",".bmp",".svg",".ico",".tiff"},
                    "videos":     {".mp4",".mkv",".avi",".mov",".wmv",".flv",".webm"},
                    "audio":      {".mp3",".wav",".flac",".aac",".ogg",".m4a"},
                    "documentos": {".pdf",".docx",".doc",".odt",".txt",".md",".rtf"},
                    "planilhas":  {".xlsx",".xls",".csv",".ods"},
                    "codigo":     {".py",".js",".ts",".html",".css",".json",".xml",".yaml",".yml",".sh",".bat"},
                    "compactados":{".zip",".rar",".7z",".tar",".gz",".bz2"},
                    "executaveis":{".exe",".msi",".dmg",".deb",".apk"},
                }
                moves = []
                for entry in path.iterdir():
                    if not entry.is_file():
                        continue
                    ext = entry.suffix.lower()
                    folder = next((k for k, exts in EXT_MAP.items() if ext in exts), "outros")
                    dest_dir = path / folder
                    dest = dest_dir / entry.name
                    moves.append({"from": str(entry), "to": str(dest), "category": folder})
                    if not dry_run:
                        dest_dir.mkdir(exist_ok=True)
                        shutil.move(str(entry), str(dest))
                self._send_json({"path": str(path), "moved": len(moves), "dryRun": dry_run, "operations": moves})
                return
            if operation == "compress":
                destination = data.get("destination")
                if not path.exists():
                    raise FileNotFoundError("Origem não encontrada.")
                zip_path = Path(destination) if destination else path.parent / (path.name + ".zip")
                base_name = str(zip_path.with_suffix(""))
                shutil.make_archive(base_name, "zip", path.parent, path.name)
                self._send_json({"archive": str(zip_path), "source": str(path)})
                return
            if operation == "extract":
                destination = data.get("destination")
                if not path.is_file():
                    raise FileNotFoundError("Arquivo não encontrado.")
                import zipfile
                dest_dir = Path(destination) if destination else path.parent / path.stem
                dest_dir.mkdir(parents=True, exist_ok=True)
                with zipfile.ZipFile(path, "r") as zf:
                    zf.extractall(dest_dir)
                self._send_json({"extracted": str(dest_dir), "archive": str(path)})
                return
            if operation == "list":
                if not path.is_dir():
                    raise FileNotFoundError("Pasta não encontrada.")
                entries = []
                for entry in sorted(path.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower())):
                    stat = entry.stat()
                    entries.append({"name": entry.name, "path": str(entry), "isDir": entry.is_dir(), "size": stat.st_size, "modified": int(stat.st_mtime)})
                self._send_json(entries)
                return
            if operation == "read":
                if not path.is_file():
                    raise FileNotFoundError("Arquivo não encontrado.")
                self._send_json({"path": str(path), "content": path.read_text(encoding="utf-8", errors="replace")})
                return
            if operation == "write":
                content = data.get("content")
                if not isinstance(content, str):
                    raise ValueError("O conteúdo precisa ser texto.")
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
                self._send_json({"path": str(path), "written": len(content)})
                return
            if operation == "mkdir":
                path.mkdir(parents=True, exist_ok=True)
                self._send_json({"path": str(path), "created": True})
                return
            if operation in {"copy", "move"}:
                destination = self._local_path(data.get("destination"))
                if not path.exists():
                    raise FileNotFoundError("Origem não encontrada.")
                destination.parent.mkdir(parents=True, exist_ok=True)
                if operation == "copy":
                    shutil.copytree(path, destination, dirs_exist_ok=True) if path.is_dir() else shutil.copy2(path, destination)
                else:
                    shutil.move(str(path), str(destination))
                self._send_json({"from": str(path), "to": str(destination), "operation": operation})
                return
            if operation == "delete":
                if not path.exists():
                    raise FileNotFoundError("Arquivo ou pasta não encontrado.")
                shutil.rmtree(path) if path.is_dir() else path.unlink()
                self._send_json({"path": str(path), "deleted": True})
                return
            if operation == "search":
                query = str(data.get("query", "")).lower().strip()
                if not query:
                    raise ValueError("Informe um termo de busca.")
                if not path.is_dir():
                    raise FileNotFoundError("Pasta não encontrada.")
                results = []
                for entry in path.rglob("*"):
                    if query in entry.name.lower():
                        results.append({"name": entry.name, "path": str(entry), "isDir": entry.is_dir()})
                    if len(results) >= 500:
                        break
                self._send_json({"results": results, "truncated": len(results) >= 500})
                return
            self._send_error(404, "Operação de arquivos desconhecida.")
        except (OSError, ValueError, PermissionError) as exc:
            self._send_error(400 if not isinstance(exc, PermissionError) else 423, str(exc))

    def _handle_clipboard(self, parsed):
        try:
            self._require_remote_access()
            data = self._read_json_body()
            if parsed.path == "/api/system/clipboard/get":
                text = ""
                if platform.system() == "Windows":
                    result = subprocess.run(
                        ["powershell", "-NoProfile", "-Command", "Get-Clipboard"],
                        capture_output=True, text=True, timeout=5
                    )
                    text = result.stdout.strip()
                elif platform.system() == "Darwin":
                    result = subprocess.run(["pbpaste"], capture_output=True, text=True, timeout=5)
                    text = result.stdout
                else:
                    result = subprocess.run(["xclip", "-o", "-selection", "clipboard"],
                                            capture_output=True, text=True, timeout=5)
                    text = result.stdout
                self._send_json({"text": text})
                return
            if parsed.path == "/api/system/clipboard/set":
                text = str(data.get("text", ""))
                if platform.system() == "Windows":
                    subprocess.run(
                        ["powershell", "-NoProfile", "-Command", f"Set-Clipboard -Value '{text}'"],
                        capture_output=True, timeout=5
                    )
                elif platform.system() == "Darwin":
                    subprocess.run(["pbcopy"], input=text.encode(), timeout=5)
                else:
                    p = subprocess.Popen(["xclip", "-selection", "clipboard"], stdin=subprocess.PIPE)
                    p.communicate(input=text.encode())
                self._send_json({"ok": True})
                return
            self._send_error(404, "Rota de clipboard desconhecida.")
        except (OSError, ValueError, PermissionError, subprocess.TimeoutExpired) as exc:
            self._send_error(423 if isinstance(exc, PermissionError) else 400, str(exc))

    def _handle_music(self):
        try:
            self._require_remote_access()
            data   = self._read_json_body()
            action = str(data.get("action", "")).strip()
            value  = data.get("value")
            sys    = platform.system()

            # ── Helpers de tecla de mídia (Windows) ──────────────
            def _media_key(vk):
                # Envia virtual key via PowerShell SendKeys
                subprocess.run(
                    ["powershell", "-NoProfile", "-Command",
                     f"$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys([char]{vk})"],
                    capture_output=True, timeout=5
                )

            # ── Ações ──────────────────────────────────────────────
            if action == "play_pause":
                if sys == "Windows":
                    _media_key(179)   # VK_MEDIA_PLAY_PAUSE
                else:
                    subprocess.run(["playerctl", "play-pause"], capture_output=True, timeout=5)
                self._send_json({"action": "play_pause", "ok": True})

            elif action == "play":
                if sys == "Windows":
                    _media_key(179)
                else:
                    subprocess.run(["playerctl", "play"], capture_output=True, timeout=5)
                self._send_json({"action": "play", "ok": True})

            elif action == "pause":
                if sys == "Windows":
                    _media_key(179)
                else:
                    subprocess.run(["playerctl", "pause"], capture_output=True, timeout=5)
                self._send_json({"action": "pause", "ok": True})

            elif action == "stop":
                if sys == "Windows":
                    _media_key(178)   # VK_MEDIA_STOP
                else:
                    subprocess.run(["playerctl", "stop"], capture_output=True, timeout=5)
                self._send_json({"action": "stop", "ok": True})

            elif action == "next":
                if sys == "Windows":
                    _media_key(176)   # VK_MEDIA_NEXT_TRACK
                else:
                    subprocess.run(["playerctl", "next"], capture_output=True, timeout=5)
                self._send_json({"action": "next", "ok": True})

            elif action == "previous":
                if sys == "Windows":
                    _media_key(177)   # VK_MEDIA_PREV_TRACK
                else:
                    subprocess.run(["playerctl", "previous"], capture_output=True, timeout=5)
                self._send_json({"action": "previous", "ok": True})

            elif action == "mute":
                if sys == "Windows":
                    _media_key(173)   # VK_VOLUME_MUTE
                else:
                    subprocess.run(["playerctl", "volume", "0"], capture_output=True, timeout=5)
                self._send_json({"action": "mute", "ok": True})

            elif action == "volume":
                level = int(value) if value is not None else 50
                level = max(0, min(100, level))
                if sys == "Windows":
                    # Usa PowerShell para ajustar volume do sistema via COM
                    ps = (
                        "Add-Type -TypeDefinition '"
                        "using System.Runtime.InteropServices;"
                        "[Guid(\"5CDF2C82-841E-4546-9722-0CF74078229A\")]"
                        "[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]"
                        "interface IAudioEndpointVolume { void _VtblGap(); void _VtblGap2();"
                        "void SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);}' -PassThru;"
                        f"$vol = [Activator]::CreateInstance([type]::GetTypeFromCLSID('BCDE0395-E52F-467C-8E3D-C4579291692E'));"
                        f"$vol.SetMasterVolumeLevelScalar({level / 100.0}, [System.Guid]::Empty)"
                    )
                    # Fallback mais simples via nircmd se disponível, senão usa WScript
                    simple_ps = (
                        f"$wsh = New-Object -ComObject WScript.Shell;"
                        # Primeiro muda para 0 depois sobe — workaround simples
                        # O método mais confiável no Windows é via nircmd ou PowerShell Audio API
                        # Usamos Set-Volume do módulo AudioDeviceCmdlets se disponível
                        f"try {{ Set-Volume -Level {level} }} catch {{"
                        f"  $obj = New-Object -ComObject WScript.Shell;"
                        # Ajusta usando VK_VOLUME_UP/DOWN de forma proporcional — não ideal
                        # mas funciona sem dependências externas
                        f"  for ($i=0; $i -lt 50; $i++) {{ $obj.SendKeys([char]174) }};"
                        f"  for ($i=0; $i -lt [int]({level}/2); $i++) {{ $obj.SendKeys([char]175) }}"
                        f"}}"
                    )
                    subprocess.run(
                        ["powershell", "-NoProfile", "-Command", simple_ps],
                        capture_output=True, timeout=10
                    )
                else:
                    subprocess.run(["playerctl", "volume", str(level / 100.0)], capture_output=True, timeout=5)
                self._send_json({"action": "volume", "level": level, "ok": True})

            elif action == "status":
                status = {"action": "status", "playing": None, "title": None, "artist": None, "volume": None}
                if sys == "Windows":
                    # Tenta ler via PowerShell SMTC (System Media Transport Controls) — Win10+
                    ps = (
                        "Add-Type -AssemblyName System.Runtime.WindowsRuntime;"
                        "$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 };"
                        "$requestAccess = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]::RequestAccessAsync();"
                        "$manager = $asTask.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]).Invoke($null, @($requestAccess)).Result;"
                        "$session = $manager.GetCurrentSession();"
                        "if ($session) {"
                        "  $info = $asTask.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]).Invoke($null, @($session.TryGetMediaPropertiesAsync())).Result;"
                        "  Write-Output \"$($info.Title)|$($info.Artist)|$($session.GetPlaybackInfo().PlaybackStatus)\""
                        "} else { Write-Output '||Stopped' }"
                    )
                    r = subprocess.run(
                        ["powershell", "-NoProfile", "-Command", ps],
                        capture_output=True, text=True, timeout=10
                    )
                    out = r.stdout.strip()
                    if "|" in out:
                        parts = out.split("|")
                        status["title"]   = parts[0] or None
                        status["artist"]  = parts[1] or None
                        status["playing"] = "playing" in (parts[2] if len(parts) > 2 else "").lower()
                else:
                    for cmd, key in [("title", "title"), ("artist", "artist"), ("status", "status")]:
                        r = subprocess.run(["playerctl", "metadata", "--format", f"{{xesam:{cmd}}}"] if cmd != "status"
                                           else ["playerctl", "status"],
                                           capture_output=True, text=True, timeout=5)
                        val = r.stdout.strip()
                        if key == "status":
                            status["playing"] = val.lower() == "playing"
                        else:
                            status[key] = val or None
                self._send_json(status)

            else:
                self._send_error(400, f"Ação de mídia desconhecida: {action}")

        except (OSError, ValueError, PermissionError, subprocess.TimeoutExpired) as exc:
            self._send_error(423 if isinstance(exc, PermissionError) else 400, str(exc))

    # ── Spotify API ───────────────────────────────────────────
    def _spotify_token(self):
        """Retorna um token de acesso válido via Client Credentials."""
        global _spotify_token_cache
        now = time.time()
        if _spotify_token_cache["access_token"] and _spotify_token_cache["expires_at"] > now + 30:
            return _spotify_token_cache["access_token"]

        if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET:
            raise ValueError(
                "SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET não configurados no .env do servidor."
            )

        creds   = base64.b64encode(f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()).decode()
        payload = urlencode({"grant_type": "client_credentials"}).encode()
        req     = urllib.request.Request(
            "https://accounts.spotify.com/api/token",
            data=payload,
            headers={
                "Authorization": f"Basic {creds}",
                "Content-Type":  "application/x-www-form-urlencoded",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())

        _spotify_token_cache["access_token"] = data["access_token"]
        _spotify_token_cache["expires_at"]   = now + int(data.get("expires_in", 3600))
        return data["access_token"]

    def _spotify_request(self, method, path, body=None, params=None):
        """Faz uma requisição autenticada à Web API do Spotify."""
        token = self._spotify_token()
        url   = f"https://api.spotify.com/v1{path}"
        if params:
            url += "?" + urlencode(params)
        data = json.dumps(body).encode() if body is not None else None
        req  = urllib.request.Request(
            url, data=data,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type":  "application/json",
            },
            method=method,
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}

    def _handle_spotify(self, parsed):
        try:
            data      = self._read_json_body()
            operation = parsed.path.rsplit("/", 1)[-1]   # search | play | playlist | devices | pause | resume | next | previous | status

            # ── Buscar faixas ─────────────────────────────────
            if operation == "search":
                q     = str(data.get("query", "")).strip()
                limit = int(data.get("limit", 5))
                if not q:
                    raise ValueError("Parâmetro 'query' obrigatório.")
                res   = self._spotify_request("GET", "/search", params={"q": q, "type": "track,playlist", "limit": limit, "market": "BR"})
                tracks = [
                    {
                        "id":      t["id"],
                        "name":    t["name"],
                        "artist":  ", ".join(a["name"] for a in t["artists"]),
                        "album":   t["album"]["name"],
                        "uri":     t["uri"],
                        "url":     t["external_urls"].get("spotify", ""),
                    }
                    for t in res.get("tracks", {}).get("items", [])
                ]
                playlists = [
                    {
                        "id":    p["id"],
                        "name":  p["name"],
                        "owner": p["owner"]["display_name"],
                        "uri":   p["uri"],
                        "url":   p["external_urls"].get("spotify", ""),
                        "total": p.get("tracks", {}).get("total", 0),
                    }
                    for p in res.get("playlists", {}).get("items", [])
                ]
                self._send_json({"tracks": tracks, "playlists": playlists})
                return

            # ── Tocar uma faixa específica ─────────────────────
            if operation == "play":
                uri = str(data.get("uri", "")).strip()
                if not uri:
                    raise ValueError("Parâmetro 'uri' (spotify:track:...) obrigatório.")
                # PUT /me/player/play exige OAuth — abre a URL pública com Client Credentials
                track_id = uri.split(":")[-1]
                target   = f"https://open.spotify.com/track/{track_id}"
                webbrowser.open(target)
                self._send_json({"opened": target, "uri": uri})
                return

            # ── Tocar uma playlist ─────────────────────────────
            if operation == "playlist":
                uri     = str(data.get("uri", "")).strip()
                pl_id   = str(data.get("playlist_id", "")).strip()
                # Resolve URI
                if not uri and pl_id:
                    uri = f"spotify:playlist:{pl_id}"
                if not uri:
                    raise ValueError("Parâmetro 'uri' ou 'playlist_id' obrigatório.")
                playlist_id = uri.split(":")[-1]
                target      = f"https://open.spotify.com/playlist/{playlist_id}"
                webbrowser.open(target)
                self._send_json({"opened": target, "uri": uri})
                return

            # ── Status / faixa atual (só funciona com OAuth) ───
            if operation == "status":
                # Com Client Credentials não é possível ler o player do usuário.
                # Retornamos info útil sobre as capacidades disponíveis.
                self._send_json({
                    "note": "Para controle completo do player (pause/resume/status em tempo real) é necessário OAuth do usuário. Use spotify.search + spotify.play para abrir músicas.",
                    "client_credentials_ok": bool(SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET),
                })
                return

            self._send_error(404, f"Operação Spotify desconhecida: {operation}")

        except ValueError as exc:
            self._send_error(400, str(exc))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            self._send_error(exc.code, f"Spotify API erro {exc.code}: {body[:300]}")
        except Exception as exc:
            self._send_error(500, f"Erro interno Spotify: {exc}")

    def _handle_process_list(self):
        try:
            self._require_remote_access()
            if not HAS_PSUTIL:
                self._send_json([])
                return
            self._send_json([
                {"pid": proc.info["pid"], "name": proc.info["name"] or "desconhecido", "mem": proc.info["memory_percent"] or 0}
                for proc in psutil.process_iter(["pid", "name", "memory_percent"])
            ])
        except (Exception, PermissionError) as exc:
            self._send_error(423 if isinstance(exc, PermissionError) else 500, str(exc))

    def _handle_system_action(self, parsed):
        try:
            self._require_remote_access()
            data = self._read_json_body()
            if parsed.path == "/api/system/kill":
                pid = int(data.get("pid"))
                if HAS_PSUTIL:
                    psutil.Process(pid).terminate()
                else:
                    subprocess.run(["taskkill", "/PID", str(pid), "/F"], check=True, capture_output=True)
                self._send_json({"pid": pid, "ok": True})
                return
            if parsed.path == "/api/system/exec":
                command = data.get("command")
                if not isinstance(command, str) or not command.strip():
                    raise ValueError("Comando obrigatório.")
                result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=60)
                self._send_json({"stdout": result.stdout, "stderr": result.stderr, "code": result.returncode})
                return
            target = data.get("target")
            if not isinstance(target, str) or not target.strip():
                raise ValueError("Destino obrigatório.")
            webbrowser.open(target) if target.startswith(("http://", "https://")) else os.startfile(target)
            self._send_json({"opened": target})
        except (OSError, ValueError, PermissionError, subprocess.TimeoutExpired) as exc:
            self._send_error(423 if isinstance(exc, PermissionError) else 400, str(exc))

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

    # ── Network API (chamadas HTTP genéricas a APIs externas) ─
    def _is_safe_host(self, hostname: str) -> bool:
        """Bloqueia loopback, redes privadas (RFC1918) e link-local — evita que
        a tool network.request seja usada pra alcançar serviços internos
        (localhost, rede local, metadata endpoints de cloud, etc.)."""
        try:
            infos = socket.getaddrinfo(hostname, None)
        except socket.gaierror:
            return False
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
        return True

    def _handle_network_request(self, parsed):
        try:
            data    = self._read_json_body()
            url     = str(data.get("url", "")).strip()
            method  = str(data.get("method", "GET")).upper()
            headers = data.get("headers") or {}
            body    = data.get("body")

            if not url.startswith(("http://", "https://")):
                raise ValueError("URL deve começar com http:// ou https://.")
            if method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"):
                raise ValueError(f"Método HTTP não suportado: {method}")
            if not isinstance(headers, dict):
                raise ValueError("headers deve ser um objeto.")

            hostname = urlparse(url).hostname or ""
            if not self._is_safe_host(hostname):
                raise ValueError("Host bloqueado: URLs para endereços privados/locais não são permitidas.")

            req_body = None
            send_headers = dict(headers)
            if body is not None and method not in ("GET", "HEAD"):
                if isinstance(body, (dict, list)):
                    req_body = json.dumps(body).encode("utf-8")
                    send_headers.setdefault("Content-Type", "application/json")
                else:
                    req_body = str(body).encode("utf-8")

            req = urllib.request.Request(url, data=req_body, method=method, headers=send_headers)
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    raw    = resp.read(524288)  # max 512 KB
                    status = resp.status
                    resp_headers = dict(resp.headers.items())
            except urllib.error.HTTPError as e:
                raw          = e.read(524288)
                status       = e.code
                resp_headers = dict(e.headers.items()) if e.headers else {}

            content_type = resp_headers.get("Content-Type", "")
            charset = "utf-8"
            if "charset=" in content_type:
                charset = content_type.split("charset=")[-1].split(";")[0].strip()
            text = raw.decode(charset, errors="replace")

            parsed_json = None
            if "json" in content_type:
                try:
                    parsed_json = json.loads(text)
                except Exception:
                    parsed_json = None

            self._send_json({
                "status": status,
                "ok": 200 <= status < 300,
                "headers": resp_headers,
                "text": text[:20000],
                "json": parsed_json,
                "truncated": len(text) > 20000
            })
        except ValueError as e:
            self._send_error(400, str(e))
        except Exception as e:
            self._send_error(502, f"Falha na requisição: {e}")

    # ── Execução de código (path existente ou snippet inline) ──
    _CODE_EXT_MAP = {
        ".py":  ["python"],
        ".js":  ["node"],
        ".mjs": ["node"],
        ".sh":  ["bash"],
        ".ps1": ["powershell", "-File"],
    }
    _CODE_LANG_MAP = {
        "python":     {"ext": ".py",  "cmd": ["python"]},
        "javascript": {"ext": ".js",  "cmd": ["node"]},
        "node":       {"ext": ".js",  "cmd": ["node"]},
        "bash":       {"ext": ".sh",  "cmd": ["bash"]},
        "shell":      {"ext": ".sh",  "cmd": ["bash"]},
        "powershell": {"ext": ".ps1", "cmd": ["powershell", "-File"]},
    }

    def _handle_code_run(self, parsed):
        tmp_created = None
        try:
            self._require_remote_access()
            data    = self._read_json_body()
            timeout = min(int(data.get("timeout", 30)), 120)
            args    = data.get("args") or []
            if not isinstance(args, list):
                raise ValueError("args deve ser uma lista.")

            if data.get("path"):
                target = self._local_path(data["path"])
                if not target.exists():
                    raise ValueError(f"Arquivo não encontrado: {target}")
                cmd_base = self._CODE_EXT_MAP.get(target.suffix.lower())
                if not cmd_base:
                    raise ValueError(f"Extensão não suportada: {target.suffix}. Suportadas: {', '.join(self._CODE_EXT_MAP)}")
                cmd = cmd_base + [str(target)] + [str(a) for a in args]
            elif data.get("code"):
                language = str(data.get("language", "")).lower()
                info = self._CODE_LANG_MAP.get(language)
                if not info:
                    raise ValueError(f"language deve ser um de: {', '.join(self._CODE_LANG_MAP)}")
                tmp_created = Path(tempfile.gettempdir()) / f"signalis_run_{secrets.token_hex(6)}{info['ext']}"
                tmp_created.write_text(data["code"], encoding="utf-8")
                cmd = info["cmd"] + [str(tmp_created)] + [str(a) for a in args]
            else:
                raise ValueError("Informe 'path' (arquivo existente) ou 'code' + 'language' (snippet inline).")

            stdout, stderr, code = self._run_cli(cmd, timeout=timeout)
            self._send_json({"ok": code == 0, "exitCode": code, "stdout": stdout[:20000], "stderr": stderr[:20000]})
        except (ValueError, PermissionError) as exc:
            self._send_error(423 if isinstance(exc, PermissionError) else 400, str(exc))
        finally:
            if tmp_created is not None and tmp_created.exists():
                try:
                    tmp_created.unlink()
                except OSError:
                    pass

    # ── VS Code (via CLI `code`) ───────────────────────────────
    def _run_cli(self, args, timeout=20):
        try:
            result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
            return result.stdout, result.stderr, result.returncode
        except FileNotFoundError:
            raise ValueError(f"Comando não encontrado: '{args[0]}'. Verifique se está instalado e no PATH.")
        except subprocess.TimeoutExpired:
            raise ValueError(f"Comando '{args[0]}' excedeu o tempo limite ({timeout}s).")

    def _handle_vscode(self, parsed):
        try:
            self._require_remote_access()
            data = self._read_json_body()
            op = parsed.path.rsplit("/", 1)[-1]

            if op == "open":
                target = self._local_path(data.get("path"))
                if not target.exists():
                    raise ValueError(f"Caminho não encontrado: {target}")
                cmd = ["code"]
                if data.get("newWindow"):
                    cmd.append("-n")
                line = data.get("line")
                if line:
                    cmd += ["-g", f"{target}:{int(line)}"]
                else:
                    cmd.append(str(target))
                _, stderr, code = self._run_cli(cmd)
                self._send_json({"opened": str(target), "ok": code == 0, "stderr": stderr})
                return

            if op == "diff":
                fileA = self._local_path(data.get("fileA"))
                fileB = self._local_path(data.get("fileB"))
                for f in (fileA, fileB):
                    if not f.exists():
                        raise ValueError(f"Arquivo não encontrado: {f}")
                _, stderr, code = self._run_cli(["code", "--diff", str(fileA), str(fileB)])
                self._send_json({"diffOpened": True, "ok": code == 0, "stderr": stderr})
                return

            raise ValueError(f"Operação vscode desconhecida: {op}")
        except (ValueError, PermissionError) as exc:
            self._send_error(423 if isinstance(exc, PermissionError) else 400, str(exc))

    # ── Git (subprocess por lista de argumentos — nunca shell=True) ──
    def _git_repo(self, repo_path):
        repo = self._local_path(repo_path)
        if not repo.exists() or not repo.is_dir():
            raise ValueError(f"Diretório não encontrado: {repo}")
        _, _, code = self._run_cli(["git", "-C", str(repo), "rev-parse", "--is-inside-work-tree"])
        if code != 0:
            raise ValueError(f"Não é um repositório git: {repo}")
        return repo

    def _handle_git(self, parsed):
        try:
            self._require_remote_access()
            data = self._read_json_body()
            action = parsed.path.rsplit("/", 1)[-1]
            repo = self._git_repo(data.get("repoPath"))
            base = ["git", "-C", str(repo)]

            if action == "status":
                stdout, stderr, code = self._run_cli(base + ["status", "--porcelain=v1", "-b"])
                self._send_json({"ok": code == 0, "status": stdout, "stderr": stderr})
                return

            if action == "diff":
                cmd = base + ["diff"]
                if data.get("staged"):
                    cmd.append("--staged")
                if data.get("file"):
                    cmd += ["--", str(data["file"])]
                stdout, stderr, code = self._run_cli(cmd, timeout=30)
                self._send_json({"ok": code == 0, "diff": stdout[:20000], "truncated": len(stdout) > 20000, "stderr": stderr})
                return

            if action == "log":
                limit = min(int(data.get("limit", 15)), 100)
                stdout, stderr, code = self._run_cli(base + ["log", f"-n{limit}", "--pretty=format:%h|%an|%ad|%s", "--date=short"])
                commits = [dict(zip(("hash", "author", "date", "message"), line.split("|", 3)))
                           for line in stdout.splitlines() if line.strip()]
                self._send_json({"ok": code == 0, "commits": commits, "stderr": stderr})
                return

            if action == "add":
                files = data.get("files")
                if not isinstance(files, list) or not files:
                    raise ValueError("files deve ser uma lista não-vazia de caminhos relativos ao repo.")
                stdout, stderr, code = self._run_cli(base + ["add", "--"] + [str(f) for f in files])
                self._send_json({"ok": code == 0, "added": files, "stderr": stderr})
                return

            if action == "commit":
                message = str(data.get("message", "")).strip()
                if not message:
                    raise ValueError("message é obrigatória.")
                stdout, stderr, code = self._run_cli(base + ["commit", "-m", message])
                self._send_json({"ok": code == 0, "output": stdout, "stderr": stderr})
                return

            if action == "push":
                remote = str(data.get("remote", "origin"))
                branch = data.get("branch")
                cmd = base + ["push", remote] + ([str(branch)] if branch else [])
                stdout, stderr, code = self._run_cli(cmd, timeout=60)
                self._send_json({"ok": code == 0, "output": stdout, "stderr": stderr})
                return

            if action == "branch":
                new_branch = data.get("name")
                if new_branch:
                    stdout, stderr, code = self._run_cli(base + ["checkout", "-b", str(new_branch)])
                else:
                    stdout, stderr, code = self._run_cli(base + ["branch"])
                self._send_json({"ok": code == 0, "output": stdout, "stderr": stderr})
                return

            raise ValueError(f"Ação git desconhecida: {action}")
        except (ValueError, PermissionError) as exc:
            self._send_error(423 if isinstance(exc, PermissionError) else 400, str(exc))

    # ── Browser API (fetch / scrape) ──────────────────────────
    def _handle_browser_api(self, parsed):
        try:
            data      = self._read_json_body()
            operation = parsed.path.rsplit("/", 1)[-1]
            url       = str(data.get("url", "")).strip()
            if not url.startswith(("http://", "https://")):
                raise ValueError("URL deve começar com http:// ou https://.")

            browser_h = {
                "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept":          "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            }
            req = urllib.request.Request(url, headers=browser_h)
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw = resp.read(524288)  # max 512 KB
                charset = "utf-8"
                ct = resp.headers.get("Content-Type", "")
                if "charset=" in ct:
                    charset = ct.split("charset=")[-1].split(";")[0].strip()
                html = raw.decode(charset, errors="replace")

            import re as _re

            if operation == "fetch":
                max_chars = int(data.get("maxChars", 6000))
                # Remove scripts, styles, head
                clean = _re.sub(r"<(script|style|head)[^>]*>.*?</\1>", " ", html, flags=_re.S | _re.I)
                # Remove todas as tags
                clean = _re.sub(r"<[^>]+>", " ", clean)
                # Colapsa espaços
                clean = _re.sub(r"[ \t]+", " ", clean)
                clean = _re.sub(r"\n{3,}", "\n\n", clean).strip()
                self._send_json({"url": url, "text": clean[:max_chars], "truncated": len(clean) > max_chars})
                return

            if operation == "scrape":
                filter_str = str(data.get("filter", "") or "").lower()
                # Títulos h1-h4
                titles = [_re.sub(r"<[^>]+>", "", m).strip()
                          for m in _re.findall(r"<h[1-4][^>]*>(.*?)</h[1-4]>", html, _re.S | _re.I)]
                # Links href
                links_raw = _re.findall(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, _re.S | _re.I)
                links = []
                for href, text in links_raw:
                    label = _re.sub(r"<[^>]+>", "", text).strip()
                    if not label or not href.startswith(("http", "/")):
                        continue
                    if filter_str and filter_str not in href.lower():
                        continue
                    links.append({"href": href, "text": label})
                # Parágrafos
                paras = [_re.sub(r"<[^>]+>", "", p).strip()
                         for p in _re.findall(r"<p[^>]*>(.*?)</p>", html, _re.S | _re.I)]
                paras = [p for p in paras if len(p) > 40]
                self._send_json({
                    "url": url,
                    "titles": titles[:10],
                    "links":  links[:30],
                    "paragraphs": paras[:10]
                })
                return

            self._send_error(404, "Operação de browser desconhecida.")
        except (OSError, ValueError, urllib.error.URLError) as exc:
            self._send_error(400, str(exc))

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
        payload = json.dumps({"error": str(message), "status": status}).encode("utf-8")
        self._send_response(status, payload, {
            "Content-Type": "application/json; charset=utf-8",
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
        conf.get_default().auth_token = NGROK_AUTHTOKEN
        # Abre o túnel público apontando para a porta do servidor
        public_tunnel = ngrok.connect(PORT)
        print(f"║  URL PÚBLICA : {public_tunnel.public_url:<21} ║")
    except ImportError:
        print(f"║  TUNNEL      : pyngrok não instalado  ║")
    except Exception as e:
        print(f"║  TUNNEL ERRO : {str(e)[:21]:<21} ║")

    print(f"╚══════════════════════════════════════╝\n")

    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
