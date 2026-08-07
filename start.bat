@echo off
:: SIGNALIS-OS // Launcher Windows (Node portable)
:: Coloque este arquivo na raiz do projeto, junto com a pasta node/

setlocal

:: Caminho do Node portable (relativo a este .bat)
set "NODE_DIR=%~dp0node"
set "NODE=%NODE_DIR%\node.exe"
set "NPM=%NODE_DIR%\npm.cmd"

:: Verifica se o Node portable existe
if not exist "%NODE%" (
    echo.
    echo  [ERRO] Node portable nao encontrado em: %NODE_DIR%
    echo.
    echo  Baixe em: https://nodejs.org/en/download
    echo  Escolha: Windows x64 zip
    echo  Extraia para a pasta "node" dentro do projeto.
    echo.
    pause
    exit /b 1
)

echo.
echo  SIGNALIS-OS // LAUNCHER
echo  Node: %NODE%
echo.

:: Instala dependencias se node_modules nao existir
if not exist "%~dp0node_modules" (
    echo  Instalando dependencias ^(primeira vez^)...
    "%NPM%" install --prefix "%~dp0"
    echo.
)

:: Configura variaveis de ambiente
set "LLM_PROVIDER=%LLM_PROVIDER%"
if "%LLM_PROVIDER%"=="" set "LLM_PROVIDER=ollama"

set "OLLAMA_MODEL=%OLLAMA_MODEL%"
if "%OLLAMA_MODEL%"=="" set "OLLAMA_MODEL=gemma4:e4b"

:: Inicia o Electron usando o Node portable
"%NODE%" "%NODE_DIR%\node_modules\.bin\electron" "%~dp0"

endlocal
