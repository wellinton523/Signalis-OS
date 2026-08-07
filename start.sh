#!/bin/bash
# SIGNALIS-OS // Launcher Linux/Mac (Node portable)
# Coloque este arquivo na raiz do projeto, junto com a pasta node/

DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_DIR="$DIR/node"

# Detecta o binário correto por OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    NODE="$NODE_DIR/bin/node"
    NPM="$NODE_DIR/bin/npm"
else
    NODE="$NODE_DIR/bin/node"
    NPM="$NODE_DIR/bin/npm"
fi

# Verifica se o Node portable existe
if [ ! -f "$NODE" ]; then
    echo ""
    echo " [ERRO] Node portable não encontrado em: $NODE_DIR"
    echo ""
    echo " Baixe em: https://nodejs.org/en/download"
    echo " Escolha: Linux x64 tar.gz  (ou  macOS tar.gz)"
    echo " Extraia o conteúdo para a pasta 'node' dentro do projeto."
    echo ""
    exit 1
fi

echo ""
echo " SIGNALIS-OS // LAUNCHER"
echo " Node: $NODE"
echo " Versão: $("$NODE" --version)"
echo ""

# Instala dependências se node_modules não existir
if [ ! -d "$DIR/node_modules" ]; then
    echo " Instalando dependências (primeira vez)..."
    "$NPM" install --prefix "$DIR"
    echo ""
fi

# Variáveis de ambiente com fallback
export LLM_PROVIDER="${LLM_PROVIDER:-ollama}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-gemma4:e4b}"
export PATH="$NODE_DIR/bin:$PATH"

# Inicia o Electron
"$NODE" "$DIR/node_modules/.bin/electron" "$DIR"
