# SIGNALIS-OS // ARIS-9 — PRD

## Problema original
Melhorar o ARIS-9 no repositório SIGNALIS-OS com:
1. Raciocínio causal mais profundo.
2. Consciência subjetiva de contexto/tom.
3. Otimização proativa de fluxos.
4. Notificações quando chegar uma resposta.

## Arquitetura
- Frontend vanilla JS/HTML/CSS (SIGNALIS-OS shell + terminal).
- Backend HTTP customizado (`server.py`, ThreadingHTTPServer).
- Agente ARIS-9 com ReAct textual em `js/agent.js`.
- Ferramentas registradas em `window.toolManager` (auto-descoberta em `js/tools/**`).

## Implementado (jan/2026)

### Fase 1 — Notificações
- `js/notifications.js`: toast in-app + Notification API nativa + beep via Web Audio.
- Toast centralizado no topo com borda por tipo (success/warn/error/info) e auto-dismiss.
- Permissão nativa solicitada silenciosamente na 1ª interação real.

### Fase 2 — ARIS-9 arquiteto de soluções
- Novo `_buildSystemPrompt()` cobre raciocínio causal, leitura de tom (urgente/curioso/operacional/dúvida/desabafo) e otimização proativa de fluxos.
- Pedido de confirmação para ações irreversíveis.

### Fase 3 — Fluxos salvos (macros)
- `js/tools/automation/macro.js`: 6 tools (`macro.save`, `macro.list`, `macro.get`, `macro.delete`, `macro.run`, `macro.saveLast`) + helper `window.aris9Macros` com `match()` de trigger.
- Terminal intercepta o texto do usuário e, se casar com um trigger, executa a macro direto (sem LLM).
- Comando `.macro list|show|run|del|savelast` para gerenciamento manual.
- ARIS-9 aprendeu a sugerir salvar workflow quando detecta repetição.
- Armazenamento em `localStorage: aris9_macros`, com contador `runs` por macro.
- Validado end-to-end via Playwright: save → list → match → run → memory.set executou → contador incrementou → toast disparou.

## Backlog
- P2: comando `.notify [on|off|sound|native]` para preferências de notificação.
- P2: painel visual para editar macros (hoje só via terminal ou agente).
- P2: capturar args reais das ações no histórico (hoje `macro.saveLast` gera args vazios).
- P2: sugerir triggers automaticamente com base em frases recorrentes.
