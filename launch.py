#!/usr/bin/env python3
"""
SIGNALIS-OS // LAUNCHER
Inicializa todo o ambiente de uma vez:
  1. Verifica dependências (Python, Ollama)
  2. Baixa o modelo se necessário
  3. Cria o Modelfile com contexto expandido
  4. Sobe o Ollama em background (se local)
  5. Sobe o servidor HTTP
  6. Abre o navegador automaticamente
"""

import os
import sys
import time
import shutil
import platform
import argparse
import threading
import subprocess
import webbrowser
from pathlib import Path

# ── Configurações padrão ──────────────────────────────────────
ROOT         = Path(__file__).resolve().parent
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


def check_server_py():
    step("Verificando server.py...")
    srv = ROOT / "server.py"
    if not srv.exists():
        fail("server.py não encontrado na pasta do launcher.")
        info("Certifique-se que launch.py está na mesma pasta que server.py")
        sys.exit(1)
    ok("server.py encontrado")


def check_index_html():
    step("Verificando index.html...")
    # Aceita tanto src/index.html quanto index.html na raiz
    candidates = [ROOT / "index.html", ROOT / "src" / "index.html"]
    found = next((p for p in candidates if p.exists()), None)
    if not found:
        warn("index.html não encontrado — o servidor vai subir mas pode não exibir nada.")
    else:
        ok(f"index.html em {found.relative_to(ROOT)}")


def check_api_key():
    if LLM_PROVIDER not in CLOUD_PROVIDERS:
        return
    step(f"Verificando chave de API para {LLM_PROVIDER}...")
    if not LLM_API_KEY:
        fail(f"LLM_API_KEY não configurada para provider '{LLM_PROVIDER}'.")
        info("Configure via: export LLM_API_KEY=sua-chave")
        info("Ou rode com Ollama local: python launch.py --provider ollama")
        sys.exit(1)
    ok(f"Chave configurada ({LLM_API_KEY[:8]}...)")


def check_ollama_installed():
    step("Verificando instalação do Ollama...")
    if shutil.which("ollama"):
        ok("Ollama instalado")
        return True
    warn("Ollama não encontrado no PATH.")
    info("Instale em: https://ollama.com")
    info("Linux/Mac: curl -fsSL https://ollama.com/install.sh | sh")
    return False


def is_ollama_running():
    """Tenta conectar na API do Ollama."""
    import urllib.request, urllib.error
    try:
        urllib.request.urlopen(
            f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/tags", timeout=3
        )
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

        # Aguarda até 15s o Ollama subir
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
    """Retorna lista de modelos já baixados."""
    import urllib.request, json
    try:
        with urllib.request.urlopen(
            f"http://{OLLAMA_HOST}:{OLLAMA_PORT}/api/tags", timeout=5
        ) as r:
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
        # Roda o pull mostrando o output em tempo real
        proc = subprocess.run(["ollama", "pull", OLLAMA_MODEL])
        if proc.returncode == 0:
            ok(f"Modelo '{OLLAMA_MODEL}' baixado com sucesso")
        else:
            fail(f"Falha ao baixar o modelo (código {proc.returncode})")
    except Exception as e:
        fail(f"Erro ao executar 'ollama pull': {e}")


def create_modelfile():
    """
    Cria um modelo customizado 'aris9' com contexto expandido.
    Isso corrige o limite padrão de 4096 tokens do Ollama.
    """
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
    info(f"Modelfile criado em {modelfile_path}")

    try:
        proc = subprocess.run(
            ["ollama", "create", CUSTOM_MODEL_NAME, "-f", str(modelfile_path)],
            capture_output=True, text=True
        )
        if proc.returncode == 0:
            ok(f"Modelo '{CUSTOM_MODEL_NAME}' criado com ctx={NUM_CTX}")
        else:
            warn(f"Não foi possível criar o modelo customizado: {proc.stderr.strip()}")
            info(f"O sistema vai usar '{OLLAMA_MODEL}' diretamente com ctx padrão.")
    except Exception as e:
        warn(f"Erro ao criar Modelfile: {e}")
    finally:
        # Remove o Modelfile temporário
        if modelfile_path.exists():
            modelfile_path.unlink()


def open_browser_delayed(url, delay=2.5):
    """Abre o navegador após um pequeno delay para o servidor subir."""
    def _open():
        time.sleep(delay)
        try:
            webbrowser.open(url)
        except Exception:
            pass
    threading.Thread(target=_open, daemon=True).start()


def start_server():
    """Sobe o server.py e bloqueia (é o processo principal)."""
    url = f"http://127.0.0.1:{PORT}"
    step(f"Iniciando servidor em {bold(url)}...")
    print()
    print(cyan("══════════════════════════════════════════════"))
    print(green(f"  SIGNALIS-OS disponível em: {bold(url)}"))
    print(cyan("══════════════════════════════════════════════"))
    print(dim("  Ctrl+C para encerrar"))
    print()

    open_browser_delayed(url)

    env = os.environ.copy()
    env["PORT"]         = str(PORT)
    env["LLM_PROVIDER"] = LLM_PROVIDER
    env["LLM_API_KEY"]  = LLM_API_KEY
    env["OLLAMA_HOST"]  = OLLAMA_HOST
    env["OLLAMA_PORT"]  = str(OLLAMA_PORT)

    # Se o modelo customizado foi criado, usa ele
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
        print(cyan("\n  SIGNALIS-OS encerrado. Até logo, operador."))


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
        help=f"Modelo a usar (padrão: {OLLAMA_MODEL})\n"
             "Ollama:      gemma4:e4b, qwen2.5:3b, llama3.1\n"
             "OpenRouter:  google/gemma-4-26b-a4b-it:free\n"
             "Groq:        llama-3.1-8b-instant, gemma2-9b-it",
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
        "--no-browser",
        action="store_true",
        help="Não abre o navegador automaticamente",
    )
    p.add_argument(
        "--skip-pull",
        action="store_true",
        help="Pula o download do modelo mesmo se não existir",
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

    # Verificações básicas
    check_python()
    check_server_py()
    check_index_html()
    check_api_key()
    print()

    # Fluxo Ollama local
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

    # Sobe o servidor (bloqueia aqui)
    if args.no_browser:
        global open_browser_delayed
        open_browser_delayed = lambda *a, **kw: None

    start_server()


if __name__ == "__main__":
    main()
