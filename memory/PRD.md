# SIGNALIS-OS // ARIS-9 — PRD

## Problema original
Melhorar o ARIS-9 no repositório SIGNALIS-OS com:
1. Raciocínio causal, tom contextual, workflows proativos.
2. Notificações quando chegar uma resposta.

## Arquitetura
Frontend vanilla JS/HTML/CSS + servidor HTTP Python custom (`server.py`, ThreadingHTTPServer). Agente ARIS-9 ReAct textual em `js/agent.js`. Ferramentas em `window.toolManager` auto-descobertas em `js/tools/**`.

## Implementado

### Fase 1 — Notificações (jan/2026)
- `js/notifications.js`: toast + Notification API + beep Web Audio.
- Toast centralizado no topo, borda por tipo, auto-dismiss.

### Fase 2 — ARIS-9 arquiteto de soluções
- `_buildSystemPrompt()` reescrito: raciocínio causal, tom, workflows proativos.

### Fase 3 — Fluxos salvos (macros)
- `js/tools/automation/macro.js`: 6 tools + `window.aris9Macros.match()`.
- Terminal intercepta trigger e dispara macro sem LLM.
- `.macro list|show|run|del|savelast` no terminal.

### Fase 4 — Navegador + responsivo mobile
- `browser.openMulti` + workspaces (`browser.workspace.save/list/get/delete/open`).
- Comando `.ws` no terminal.
- Meta viewport, media queries `<768px` e `<480px`, `prefers-reduced-motion`, `hover: none`.
- `windowManager.js`: touch drag desktop only.

### Fase 5 — Menu hambúrguer mobile + bug fix respostas vazias/cortadas
- **Menu hambúrguer**: botão `#mobile-menu-btn` no titlebar (visível só <768px), drawer lateral esquerdo com Terminal/SysMon/Workspaces/Macros/Wallpaper + 3 preferências de notificação + rodapé com nível de permissão. Acessibilidade: `role=dialog`, `aria-modal=true`, `aria-expanded` toggle, foco vai para o primeiro botão ao abrir e volta ao hambúrguer ao fechar, focus trap com Tab/Shift+Tab, fecha por ✕/ESC/backdrop.
- **Bug ARIS-9 respostas vazias/cortadas**: RCA identificou 3 causas: (a) `_parseAction` com regex non-greedy quebrava com JSON aninhado; (b) `_cleanFinalResponse` deixava lixo ACTION/ARGS residual; (c) prosa antes de ACTION era descartada. Reescrito com parser de chaves balanceado (escapes/strings-aware), `_extractBalancedJson`, captura de `preText` renderizado via `window.__onAgentPreText`, fallback narrativo quando modelo retorna vazio ("Concluído. Executado: X, Y"), e prompt atualizado ("escolha OU prosa OU ação, nunca ambos").
- Layout mobile: janela usa `bottom:116px` + flexbox em vez de `height: calc(...)` para acomodar taskbar wrap.
- `data-testid` em todos elementos interativos (13 ids).

### Validação
- **Iteração 1**: 24/24 funcionais, 1 bug MEDIUM (input clip mobile).
- **Iteração 2**: 9/10, fix do clip validado; a11y falhou porque search_replace anterior tinha revertido silenciosamente.
- **Iteração 3**: **10/10 áreas passaram**. Sem bugs restantes; apenas 2 observações cosméticas de contraste.

## Backlog
- P2: contraste do `#titlebar-title` e das linhas t-dim de hint no terminal.
- P2: `data-testid="drawer-close-btn"` no ✕ do header do drawer.
- P2: swipe lateral no mobile para trocar de janela.
- P2: editor visual de macros e workspaces.
- P2: `macro.saveLast` capturar args reais (hoje gera placeholders).
- P3: extrair drawer para `js/drawer.js`; extrair `--taskbar-h` para CSS var.
