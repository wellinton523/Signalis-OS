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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote, urlencode

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
