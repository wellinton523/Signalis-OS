# SIGNALIS-OS // ARIS-9 — PRD

## Arquitetura
Vanilla JS/HTML/CSS + `server.py` (http.server, ThreadingHTTPServer). Agente ARIS-9 ReAct textual em `js/agent.js`. Ferramentas em `window.toolManager` (auto-descoberta).

## Implementado

### Fase 5 — Menu hambúrguer + fix respostas vazias
Menu drawer mobile, focus trap, aria-*; parser ReAct com chaves balanceadas.

### Fase 6 — Suite de melhorias grandes (jan/2026)
- **Prefs centrais** `window.aris9Prefs`: persona (minimal/padrao/detalhado/brincalhao), plannerMode, selfEval, dryRun, readOnly, autoConfirm, silentAuto, stream, ttsAuto, ttsVoice, ttsSpeed. Persistidas em localStorage.
- **Perfil do usuário** `window.aris9Profile` aprende intents e tópicos passivamente; bloco injetado no prompt.
- **Undo global** `window.aris9Undo` (push/list/peek/runLast); `.undo` e `.undo-list`.
- **Métricas** `window.aris9Metrics` (turns/tools/errors/latência/byTool); `.metrics` e botão no drawer.
- **Trace ReAct** `window.aris9Trace` (últimas 8 etapas); `.trace`.
- **Modos** dry-run (narra sem executar), read-only (bloqueia writes), auto-confirm (bypass) + badges visuais READ-ONLY/DRY-RUN no topo.
- **Streaming visual** char-a-char em `_typeLine`; **botão ABORTAR** flutuante durante execução.
- **Explicação humana de erros** `aris9ExplainError` (ENOENT, EACCES, timeout, quota, etc → pt-BR).
- **Detecção de fluxo repetido** `aris9DetectRepeat` sugere criar macro após 3 turnos iguais.
- **Resumo diário** `aris9DailySummary`; botão [RESUMO DO DIA] no drawer + `.daily`.
- **Modo silencioso automático** `aris9ShouldNotify` (silencia se aba visível).
- **Agenda de gatilhos** `aris9Schedules` (setInterval de 30s dispara macros por HH:MM ou intervalMs); `.schedule list|add|del`.
- **Marketplace de tools** `aris9ToolInstall(url)`; `.install <url>`.
- **`.again [ajuste]`** repete o último pedido com ajuste opcional.
- **Personas** (minimal/padrao/detalhado/brincalhao) injetadas dinamicamente no system prompt; `.persona X` e select no drawer.

### Fase 7 — Voz (Whisper + OpenAI TTS)
- Backend: `POST /api/voice/stt` (Whisper-1) e `POST /api/voice/tts` (tts-1-hd, 9 vozes) via `emergentintegrations`.
- `js/voice.js`: MediaRecorder + fetch STT/TTS, cache LRU de mp3.
- `js/voice-chat.js`: **overlay dedicado modo voz** com botão gigante de mic (push-to-talk + tap), transcript, select de 9 vozes (nova/shimmer/alloy/coral/sage/onyx/fable/echo/ash), barra de espaço = toggle, botão interromper.
- Botão [MODO VOZ] no drawer mobile + `.voice` no terminal.
- TTS automático de respostas quando `ttsAuto=on`.

### Fase 8 — Robustez
- `_send_error` retorna JSON `{error, status}`.
- Validação de voice/model no TTS (400 em vez de 500).
- `.help` do terminal lista todos os 12 comandos novos.
- z-index dos badges > titlebar.

## Validação
Iteração 4: Backend **16/16 pytest** (auth, guards, TTS 200 audio/mpeg real, STT graceful errors, /api/tools, /api/system/*). Frontend **13/14 (93%)** — o único fail era z-index (corrigido). 4 action items corrigidos e revalidados por curl+screenshot.

## Backlog
- P2: rate-limit por sessão em /api/voice/tts.
- P2: modularizar server.py (>1200 linhas) em handlers separados.
- P2: shared event-loop/OpenAI client em vez de asyncio.run() por request.
- P2: contraste do `#titlebar-title` e das linhas de hint (carry-over).
- P2: extrair drawer/commands do terminal.js para módulos próprios.

### Fase 9 — Escuta contínua + Wake word (jan/2026)
- `window.aris9Voice.startContinuousRecord({silenceMs, maxMs, minMs, threshold, onLevel})` grava até ficar em silêncio por 1.4s (VAD via Web Audio Analyser + RMS).
- `window.aris9Voice.createWakeWordDetector(word, onDetected)` usa Web Speech Recognition local (pt-BR, sem gastar Whisper), auto-restart, tratamento de 'not-allowed'.
- 3 novas prefs em `aris9Prefs`: `voiceAlwaysListen`, `wakeWordEnabled`, `wakeWord` (default 'aris').
- Modo Voz: 2 toggles + input de palavra no header; sync bidirecional com toggles do drawer principal.
- Auto follow-up: após audio.onended da resposta, se `voiceAlwaysListen`, reabre o mic com VAD em 350ms.
- Epoch token no VAD para descartar resultado se o overlay fechar/reset acontecer no meio.
- **Testing agent iteração 5**: 100% (12/12 frontend + 3/3 backend regression). Zero bugs.

### Fase 10 — Beep + Indicador global
- `_wakeBeep()`: 2 tons Web Audio (A5→E6, triangle wave) tipo confirmação de assistente. Removido data-URL quebrado.
- `#wake-indicator`: `<button role="button" tabindex="0">` no titlebar, ponto vermelho pulsante (só opacity+shadow, transform: none no wrapper). Clique OU Enter/Space abre modo voz. Sincroniza via evento `aris9:pref-changed`. Auto-start se pref era true da sessão anterior.
- Refatorei toda a lógica de wake para um orquestrador global `window.aris9Wake` em voice.js (fora do voice-chat.js). voice-chat expõe apenas `window.aris9VoiceKick` como callback.
- **Testing agent iteração 6**: 100% (12/12). 2 recomendações cosméticas de a11y aplicadas: `role=button + tabindex + Enter/Space` no indicador, e removi `transform: scale()` do keyframe para tornar automation-clickable.

### Fase 11 — Launcher auto-instala dependências
- `launch.py` ganhou `PY_DEPS` (lista de pacotes com nome pip, módulo de import, obrigatório?, extra-index-url) e `ensure_python_deps(auto_install)`.
- Pacotes gerenciados: `python-dotenv` (obrigatório), `emergentintegrations` (opcional, extra-index-url da Emergent), `psutil` (opcional), `pyngrok` (opcional).
- Flag `--no-install` para pular a instalação automática. Se um obrigatório falhar, `sys.exit(1)` com instrução clara. Opcionais viram warn com stderr resumido.
- Testado com pacote removido: launcher detectou, instalou silenciosamente e prosseguiu.

### Fase 12 — Fallback OpenAI + requirements.txt
- `server.py`: detecção automática do backend de voz (`VOICE_BACKEND = "emergent"` OR `"openai"`), preferindo `emergentintegrations` se disponível, senão a lib `openai` (PyPI público) usando `OPENAI_API_KEY`. Ambos os handlers STT/TTS suportam os dois caminhos com a mesma API.
- `launch.py`: PY_DEPS agora inclui `openai` (opcional, público) além de `emergentintegrations` (opcional, extra-index). Mensagem de erro melhor quando ambos ausentes: dá o comando exato de instalação.
- Novo `requirements.txt` documenta as opções A (openai) e B (emergent) com instruções claras.
- `env.example`: nova seção "── Voz" com OPENAI_API_KEY e EMERGENT_LLM_KEY, explicando quando usar cada uma.
- Validado: TTS via emergent backend continua devolvendo 200 audio/mpeg; simulação de emergent ausente confirmou fallback para lib `openai`.
