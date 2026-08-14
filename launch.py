#!/usr/bin/env python3
"""
SIGNALIS-OS // LAUNCHER
Inicializa todo o ambiente de uma vez:
  1. Verifica dependências (Python, Ollama)
  2. Baixa o modelo se necessário
  3. Cria o Modelfile com contexto expandido
  4. Sobe o Ollama em background (se local)
  5. Sobe o servidor HTTP (server.py)
  6. Abre o aplicativo Electron automaticamente
"""

import os
import sys
import time
import shutil
import platform
import argparse
import threading
import subprocess
from pathlib import Path

# ── Configurações padrão ──────────────────────────────────────
ROOT         = Path(__file__).resolve().parent

def load_dotenv(path):
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

load_dotenv(ROOT / ".env")

PORT         = int(os.getenv("PORT", "8000"))
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()
LLM_API_KEY  = os.getenv("LLM_API_KEY", "")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "nexusriot/Gemma-4-Uncensored-HauhauCS-Aggressive:e2b")
OLLAMA_HOST  = os.getenv("OLLAMA_HOST", "127.0.0.1")
OLLAMA_PORT  = int(os.getenv("OLLAMA_PORT", "11434"))
NUM_CTX      = int(os.getenv("NUM_CTX", "32768"))

# Nome do modelo customizado com contexto expandido
CUSTOM_MODEL_NAME = "aris9"

CLOUD_PROVIDERS = {"openrouter", "groq", "openai"}

# Global para rastrear o processo do Electron e encerrar se necessário
ELECTRON_PROCESS = None

# ── Cores no terminal ─────────────────────────────────────────
IS_WIN = platform.system() == "Windows"

def _c(code, text):
    if IS_WIN and not os.getenv("TERM"):
        return text
    return f"\033[{code}m{text}\033[0m"

def blue(t):   return _c("34", t)
def cyan(t):   return _c("36", t)
def green(t):  return _c("32", t)
def yellow(t): return _c("33", t)
def red(t):    return _c("31", t)
def dim(t):    return _c("2",  t)
def bold(t):   return _c("1",  t)


def banner():
    print()
    print(cyan("╔══════════════════════════════════════════╗"))
    print(cyan("║") + bold("  SIGNALIS-OS // ARIS-9 LAUNCHER          ") + cyan("║"))
    print(cyan("╠══════════════════════════════════════════╣"))
    print(cyan("║") + f"  Provider : {bold(LLM_PROVIDER.upper()):<32}" + cyan("║"))
    print(cyan("║") + f"  Modelo   : {bold(OLLAMA_MODEL):<32}" + cyan("║"))
    print(cyan("║") + f"  Porta    : {bold(str(PORT)):<32}" + cyan("║"))
    print(cyan("╚══════════════════════════════════════════╝"))
    print()


def step(msg):
    print(cyan("  ▶") + f" {msg}")

def ok(msg):
    print(green("  ✓") + f" {msg}")

def warn(msg):
    print(yellow("  ⚠") + f" {msg}")

def fail(msg):
    print(red("  ✗") + f" {msg}")

def info(msg):
    print(dim(f"    {msg}"))


# ── Verificações ──────────────────────────────────────────────

def check_python():
    step("Verificando Python...")
    v = sys.version_info
    if v < (3, 8):
        fail(f"Python 3.8+ necessário. Você tem {v.major}.{v.minor}")
        sys.exit(1)
    ok(f"Python {v.major}.{v.minor}.{v.micro}")


PY_DEPS = [
    ("python-dotenv",         "dotenv",              True,    []),
    ("openai",                "openai",              False,   []),
    ("emergentintegrations",  "emergentintegrations", False,  [
        "--extra-index-url", "https://d33sy5i8bnduwe.cloudfront.net/simple/"
    ]),
    ("psutil",                "psutil",              False,   []),
    ("pyngrok",               "pyngrok",             False,   []),
]

def _try_import(module_name):
    try:
        __import__(module_name)
        return True
    except Exception:
        return False

def _pip_install(pip_name, extra_args, quiet=True):
    cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", pip_name] + list(extra_args)
    if quiet:
        cmd.insert(4, "--quiet")
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            return False, (proc.stderr or proc.stdout or "").strip()[-400:]
        return True, ""
    except FileNotFoundError:
        return False, "pip não encontrado"
    except Exception as e:
        return False, str(e)

def ensure_python_deps(auto_install=True):
    step("Verificando dependências Python...")
    missing = []
    for pip_name, mod, required, extras in PY_DEPS:
        if _try_import(mod):
            ok(f"{pip_name} disponível")
        else:
            missing.append((pip_name, mod, required, extras))

    if not missing:
        return

    if not auto_install:
        for pip_name, mod, required, _ in missing:
            (fail if required else warn)(f"{pip_name} ausente" + ("" if required else " (opcional)"))
        return

    info("Instalando pacotes ausentes automaticamente...")
    still_missing_required = []
    for pip_name, mod, required, extras in missing:
        label = pip_name + ("" if required else " (opcional)")
        step(f"pip install {label}")
        succeeded, err = _pip_install(pip_name, extras)
        if succeeded and _try_import(mod):
            ok(f"{pip_name} instalado")
            continue
        if required:
            fail(f"Falha ao instalar {pip_name}: {err[:200]}")
            still_missing_required.append(pip_name)
        else:
            warn(f"{pip_name} indisponível — recurso será desligado.")
            info((err or "")[:200])

    if still_missing_required:
        fail("Dependências obrigatórias faltando. Instale manualmente:")
        for n in still_missing_required:
            info(f"pip install {n}")
        sys.exit(1)


def check_server_py():
    step("Verificando server.py...")
    srv = ROOT / "server.py"
    if not srv.exists():
        fail("server.py não encontrado na pasta do launcher.")
        sys.exit(1)
    ok("server.py encontrado")


def check_index_html():
    step("Verificando index.html...")
    candidates = [ROOT / "index.html", ROOT / "src" / "index.html"]
    found = next((p for p in candidates if p.exists()), None)
    if not found:
        warn("index.html não encontrado — o servidor pode não exibir nada.")
    else:
        ok(f"index.html em {found.relative_to(ROOT)}")


def check_api_key():
    if LLM_PROVIDER not in CLOUD_PROVIDERS:
        return
    step(f"Verificando chave de API para {LLM_PROVIDER}...")
    if not LLM_API_KEY:
        fail(f"LLM_API_KEY não configurada para provider '{LLM_PROVIDER}'.")
        sys.exit(1)
    ok(f"Chave configurada ({LLM_API_KEY[:8]}...)")


def check_ollama_installed():
    step("Verificando instalação do Ollama...")
    if shutil.which("ollama"):
        ok("Ollama instalado")
        return True
    warn("Ollama não encontrado no PATH.")
    return False


def is_ollama_running():
    import urllib.request
    try:
        urllib.request.urlopen(f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/tags", timeout=3)
        return True
    except Exception:
        return False


def start_ollama():
    step("Iniciando Ollama em background...")
    if is_ollama_running():
        ok("Ollama já está rodando")
        return

    try:
        if IS_WIN:
            subprocess.Popen(
                ["ollama", "serve"],
                creationflags=subprocess.CREATE_NEW_CONSOLE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            subprocess.Popen(
                ["ollama", "serve"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

        for i in range(15):
            time.sleep(1)
            if is_ollama_running():
                ok("Ollama iniciado")
                return
            print(dim(f"    aguardando Ollama... {i+1}s"), end="\r")
        print()
        warn("Ollama demorou mais que o esperado — continuando mesmo assim.")
    except FileNotFoundError:
        fail("Comando 'ollama' não encontrado. Instale o Ollama primeiro.")
        sys.exit(1)


def list_local_models():
    import urllib.request, json
    try:
        with urllib.request.urlopen(f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/tags", timeout=5) as r:
            data = json.loads(r.read())
            return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []


def pull_model():
    step(f"Verificando modelo '{OLLAMA_MODEL}'...")
    models = list_local_models()
    model_base = OLLAMA_MODEL.split(":")[0]

    if any(m.startswith(model_base) for m in models):
        ok(f"Modelo '{OLLAMA_MODEL}' já disponível")
        return

    warn(f"Modelo '{OLLAMA_MODEL}' não encontrado localmente.")
    resp = input(yellow(f"    Baixar agora? ({OLLAMA_MODEL}) [S/n]: ")).strip().lower()
    if resp in ("n", "não", "nao", "no"):
        warn("Pulando download — o ARIS-9 não vai funcionar sem o modelo.")
        return

    print(cyan(f"    Baixando {OLLAMA_MODEL} (pode demorar alguns minutos)..."))
    try:
        proc = subprocess.run(["ollama", "pull", OLLAMA_MODEL])
        if proc.returncode == 0:
            ok(f"Modelo '{OLLAMA_MODEL}' baixado com sucesso")
        else:
            fail(f"Falha ao baixar o modelo (código {proc.returncode})")
    except Exception as e:
        fail(f"Erro ao executar 'ollama pull': {e}")


def create_modelfile():
    step(f"Configurando contexto do modelo (num_ctx={NUM_CTX})...")
    models = list_local_models()

    if any(m.startswith(CUSTOM_MODEL_NAME) for m in models):
        ok(f"Modelo customizado '{CUSTOM_MODEL_NAME}' já existe")
        return

    modelfile_path = ROOT / "Modelfile"
    modelfile_content = f"""FROM {OLLAMA_MODEL}
PARAMETER num_ctx {NUM_CTX}
PARAMETER num_gpu 99
SYSTEM "Você é ARIS-9, a inteligência de bordo do SIGNALIS-OS."
"""
    modelfile_path.write_text(modelfile_content)

    try:
        proc = subprocess.run(
            ["ollama", "create", CUSTOM_MODEL_NAME, "-f", str(modelfile_path)],
            capture_output=True, text=True
        )
        if proc.returncode == 0:
            ok(f"Modelo '{CUSTOM_MODEL_NAME}' criado com ctx={NUM_CTX}")
        else:
            warn(f"Não foi possível criar o modelo customizado: {proc.stderr.strip()}")
    except Exception as e:
        warn(f"Erro ao criar Modelfile: {e}")
    finally:
        if modelfile_path.exists():
            modelfile_path.unlink()


# ── Execução do Electron ao invés do Navegador ───────────────────

def start_electron_delayed(delay=2.0):
    """Sobe a aplicação Electron após o servidor HTTP estar totalmente pronto."""
    global ELECTRON_PROCESS

    def _launch():
        global ELECTRON_PROCESS
        time.sleep(delay)
        step("Iniciando interface nativa via Electron...")

        # Injeta o caminho da pasta local 'node' se ela existir na raiz do projeto
        env = os.environ.copy()
        local_node = ROOT / "node"
        if local_node.exists():
            env["PATH"] = str(local_node) + os.pathsep + env.get("PATH", "")

        # Tenta executar o electron via npm local ou comando direto
        cmd = None
        if (ROOT / "node" / "npm.cmd").exists():
            cmd = [str(ROOT / "node" / "npm.cmd"), "start"]
        elif shutil.which("npm"):
            cmd = ["npm", "start"]
        elif shutil.which("npx"):
            cmd = ["npx", "electron", "."]

        if not cmd:
            fail("Não foi possível localizar 'npm' ou 'electron' para abrir o app.")
            info("Certifique-se de instalar as dependências com: npm install")
            return

        try:
            ELECTRON_PROCESS = subprocess.Popen(cmd, cwd=str(ROOT), env=env)
            ok("Janela do Electron iniciada")
        except Exception as e:
            fail(f"Erro ao disparar o Electron: {e}")

    threading.Thread(target=_launch, daemon=True).start()


def start_server():
    """Sobe o server.py e bloqueia até o encerramento do sistema."""
    url = f"http://127.0.0.1:{PORT}"
    step(f"Iniciando servidor backend em {bold(url)}...")
    print()
    print(cyan("══════════════════════════════════════════════"))
    print(green(f"  SIGNALIS-OS (ELECTRON) ativado: {bold(url)}"))
    print(cyan("══════════════════════════════════════════════"))
    print(dim("  Pressione Ctrl+C no terminal para desligar"))
    print()

    # Dispara a abertura do Electron
    start_electron_delayed()

    env = os.environ.copy()
    env["PORT"]         = str(PORT)
    env["LLM_PROVIDER"] = LLM_PROVIDER
    env["LLM_API_KEY"]  = LLM_API_KEY
    env["OLLAMA_HOST"]  = OLLAMA_HOST
    env["OLLAMA_PORT"]  = str(OLLAMA_PORT)

    models = list_local_models()
    if any(m.startswith(CUSTOM_MODEL_NAME) for m in models):
        env["OLLAMA_MODEL"] = CUSTOM_MODEL_NAME
        info(f"Usando modelo: {CUSTOM_MODEL_NAME} (ctx={NUM_CTX})")
    else:
        env["OLLAMA_MODEL"] = OLLAMA_MODEL
        info(f"Usando modelo: {OLLAMA_MODEL}")

    print()

    try:
        subprocess.run([sys.executable, str(ROOT / "server.py")], env=env)
    except KeyboardInterrupt:
        print()
        print(cyan("\n  SIGNALIS-OS encerrado. Fechando processos..."))
    finally:
        if ELECTRON_PROCESS and ELECTRON_PROCESS.poll() is None:
            ELECTRON_PROCESS.kill()


# ── CLI ───────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description="SIGNALIS-OS Launcher",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    p.add_argument(
        "--provider", "-p",
        default=LLM_PROVIDER,
        choices=["ollama", "openrouter", "groq", "openai"],
        help="Provider de IA (padrão: ollama)",
    )
    p.add_argument(
        "--model", "-m",
        default=OLLAMA_MODEL,
        help=f"Modelo a usar (padrão: {OLLAMA_MODEL})",
    )
    p.add_argument(
        "--port",
        type=int, default=PORT,
        help=f"Porta do servidor (padrão: {PORT})",
    )
    p.add_argument(
        "--key", "-k",
        default=LLM_API_KEY,
        help="Chave de API (ou use LLM_API_KEY no ambiente)",
    )
    p.add_argument(
        "--ctx",
        type=int, default=NUM_CTX,
        help=f"Tamanho do contexto para Ollama (padrão: {NUM_CTX})",
    )
    p.add_argument(
        "--no-electron",
        action="store_true",
        help="Inicia apenas o servidor sem abrir a janela do Electron",
    )
    p.add_argument(
        "--skip-pull",
        action="store_true",
        help="Pula o download do modelo mesmo se não existir",
    )
    p.add_argument(
        "--no-install",
        action="store_true",
        help="Não instala automaticamente dependências Python ausentes",
    )
    return p.parse_args()


# ── Main ──────────────────────────────────────────────────────

def main():
    global LLM_PROVIDER, OLLAMA_MODEL, PORT, LLM_API_KEY, NUM_CTX

    args = parse_args()
    LLM_PROVIDER = args.provider
    OLLAMA_MODEL = args.model
    PORT         = args.port
    LLM_API_KEY  = args.key
    NUM_CTX      = args.ctx

    banner()

    check_python()
    ensure_python_deps(auto_install=not args.no_install)
    check_server_py()
    check_index_html()
    check_api_key()
    print()

    if LLM_PROVIDER == "ollama":
        ollama_ok = check_ollama_installed()
        if ollama_ok:
            start_ollama()
            if not args.skip_pull:
                pull_model()
            create_modelfile()
        else:
            warn("Continuando sem Ollama — o agente vai usar respostas mock.")
    else:
        ok(f"Provider cloud '{LLM_PROVIDER}' configurado — sem necessidade de Ollama")

    print()

    if args.no_electron:
        global start_electron_delayed
        start_electron_delayed = lambda *a, **kw: None

    start_server()


if __name__ == "__main__":
    main()