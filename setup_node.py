#!/usr/bin/env python3
"""
SIGNALIS-OS // setup_node.py
Baixa o Node.js portable (sem instalador) e extrai na pasta ./node/
Funciona em Windows, Linux e macOS.
Só precisa rodar uma vez.
"""

import os
import sys
import platform
import urllib.request
import tarfile
import zipfile
import shutil
from pathlib import Path

# Versão LTS do Node.js
NODE_VERSION = "22.13.1"

# URLs oficiais do Node.js por OS/arquitetura
def get_download_info():
    system = platform.system().lower()
    machine = platform.machine().lower()

    # Normaliza arquitetura
    if machine in ("x86_64", "amd64"):
        arch = "x64"
    elif machine in ("aarch64", "arm64"):
        arch = "arm64"
    else:
        arch = "x64"  # fallback

    base = f"https://nodejs.org/dist/v{NODE_VERSION}"

    if system == "windows":
        filename = f"node-v{NODE_VERSION}-win-{arch}.zip"
        inner_dir = f"node-v{NODE_VERSION}-win-{arch}"
        return f"{base}/{filename}", filename, inner_dir, "zip"

    elif system == "darwin":
        filename = f"node-v{NODE_VERSION}-darwin-{arch}.tar.gz"
        inner_dir = f"node-v{NODE_VERSION}-darwin-{arch}"
        return f"{base}/{filename}", filename, inner_dir, "tar"

    else:  # Linux
        filename = f"node-v{NODE_VERSION}-linux-{arch}.tar.xz"
        inner_dir = f"node-v{NODE_VERSION}-linux-{arch}"
        return f"{base}/{filename}", filename, inner_dir, "tar"


def progress_bar(downloaded, total):
    if total <= 0:
        return
    pct = downloaded / total * 100
    filled = int(pct / 2)
    bar = "█" * filled + "░" * (50 - filled)
    mb_down = downloaded / 1_048_576
    mb_total = total / 1_048_576
    print(f"\r  [{bar}] {pct:5.1f}%  {mb_down:.1f}/{mb_total:.1f} MB", end="", flush=True)


def download(url, dest_path):
    print(f"  Baixando Node.js v{NODE_VERSION}...")
    print(f"  URL: {url}")
    print()

    def _progress(block_num, block_size, total_size):
        downloaded = block_num * block_size
        progress_bar(min(downloaded, total_size), total_size)

    urllib.request.urlretrieve(url, dest_path, _progress)
    print()  # nova linha após a barra


def extract(archive_path, fmt, inner_dir, node_dir):
    print(f"  Extraindo...")
    tmp_dir = node_dir.parent / "_node_tmp"
    tmp_dir.mkdir(exist_ok=True)

    if fmt == "zip":
        with zipfile.ZipFile(archive_path, "r") as z:
            z.extractall(tmp_dir)
    else:
        with tarfile.open(archive_path, "r:*") as t:
            t.extractall(tmp_dir)

    # Move o conteúdo da pasta interna para ./node/
    extracted = tmp_dir / inner_dir
    if node_dir.exists():
        shutil.rmtree(node_dir)
    shutil.move(str(extracted), str(node_dir))
    shutil.rmtree(tmp_dir)


def verify(node_dir):
    system = platform.system().lower()
    node_bin = node_dir / ("node.exe" if system == "windows" else "bin/node")
    if node_bin.exists():
        print(f"  Node portable em: {node_dir}")
        return True
    return False


def make_executable(node_dir):
    """No Linux/Mac, garante permissão de execução nos binários."""
    if platform.system().lower() == "windows":
        return
    bin_dir = node_dir / "bin"
    if bin_dir.exists():
        for f in bin_dir.iterdir():
            os.chmod(f, 0o755)


def main():
    project_root = Path(__file__).resolve().parent
    node_dir = project_root / "node"

    print()
    print("  SIGNALIS-OS // Setup Node portable")
    print(f"  Versão: {NODE_VERSION}")
    print(f"  Destino: {node_dir}")
    print()

    # Já existe?
    system = platform.system().lower()
    node_bin = node_dir / ("node.exe" if system == "windows" else "bin/node")
    if node_bin.exists():
        print(f"  Node portable já instalado em {node_dir}")
        print("  Para reinstalar, delete a pasta 'node' e rode novamente.")
        print()
        return

    url, filename, inner_dir, fmt = get_download_info()
    archive_path = project_root / filename

    try:
        download(url, archive_path)
        extract(archive_path, fmt, inner_dir, node_dir)
        make_executable(node_dir)

        # Remove o arquivo baixado após extrair
        archive_path.unlink()

        if verify(node_dir):
            print()
            print("  Node portable instalado com sucesso!")
            print()
            if system == "windows":
                print("  Para rodar o SIGNALIS-OS:")
                print("    start.bat")
            else:
                print("  Para rodar o SIGNALIS-OS:")
                print("    chmod +x start.sh && ./start.sh")
        else:
            print("  [ERRO] Algo deu errado na extração.")
            sys.exit(1)

    except KeyboardInterrupt:
        print("\n\n  Cancelado.")
        if archive_path.exists():
            archive_path.unlink()
        sys.exit(0)

    except Exception as e:
        print(f"\n  [ERRO] {e}")
        if archive_path.exists():
            archive_path.unlink()
        sys.exit(1)


if __name__ == "__main__":
    main()
