# SIGNALIS-OS // ARIS-9 — PRD

## Problema original
Melhorar o ARIS-9 no repositório SIGNALIS-OS com:
1. Raciocínio causal, tom contextual, workflows proativos.
2. Notificações quando chegar uma resposta.

## Arquitetura
- Frontend vanilla JS/HTML/CSS (SIGNALIS-OS shell + terminal + janelas).
- Backend HTTP customizado (`server.py`, ThreadingHTTPServer, autenticação via cookie).
- Agente ARIS-9 com ReAct textual em `js/agent.js`.
- Ferramentas registradas em `window.toolManager` (auto-descoberta em `js/tools/**`).

## Implementado (jan/2026)

### Fase 1 — Notificações
- `js/notifications.js`: toast + Notification API nativa + beep via Web Audio.
- Toast centralizado no topo com borda por tipo (success/warn/error/info) e auto-dismiss.

### Fase 2 — ARIS-9 arquiteto de soluções
- Novo `_buildSystemPrompt()` cobre raciocínio causal, leitura de tom e otimização proativa de fluxos.

### Fase 3 — Fluxos salvos (macros)
- `js/tools/automation/macro.js`: 6 tools + helper `window.aris9Macros.match()`.
- Terminal intercepta trigger e roda macro sem LLM.
- Comando `.macro list|show|run|del|savelast`.

### Fase 4 — Integração com navegador + responsividade mobile
- `js/tools/browser/openMulti.js`: abre várias URLs de uma vez.
- `js/tools/browser/workspace.js`: 5 tools (`browser.workspace.save/list/get/delete/open`) — perfis de URLs salvos ("modo trabalho" abre Gmail+Slack+Jira em uma frase).
- Comando `.ws list|show|open|save|del` no terminal.
- Prompt do ARIS-9 conhece as novas tools de navegador.
- `index.html`: meta viewport + theme-color + PWA-ready.
- `css/style.css`: media queries `< 768px` e `< 480px`, `prefers-reduced-motion`, `hover: none` (touch).
  - Janelas viram fullscreen no mobile
  - Taskbar wrap em várias linhas com botões touch-friendly
  - Toast quase full-width no celular
  - Auth card responsivo com inputs >= 44px de altura
- `js/windowManager.js`: drag por toque (touch events) desktop only — mobile mantém janela fixa.

## Validação
Playwright em viewport 390x800:
- `innerWidth = 390`, media query aciona
- Terminal ocupa 100vw
- Workspace `trabalho` com 3 URLs salvo e recuperado
- 10 tools de browser registradas
- Toast responsivo aparece na largura correta

## Backlog
- P2: painel visual para editar macros e workspaces.
- P2: capturar args reais no `macro.saveLast`.
- P2: sugerir triggers automaticamente baseado em frases recorrentes.
- P2: hamburger menu no titlebar mobile para acessar SysMon/Wallpaper.
- P2: gestos (swipe) para trocar janela no mobile.
