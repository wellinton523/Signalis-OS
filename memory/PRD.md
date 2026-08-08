# SIGNALIS-OS // ARIS-9 — PRD

## Problema original
Melhorar o ARIS-9 no repositório SIGNALIS-OS com:
1. Raciocínio causal mais profundo (entender porquê + antecipar consequências).
2. Consciência subjetiva de contexto/tom (urgente → resumo executivo; curioso → detalhes).
3. Otimização proativa de fluxos (identificar gargalos, sugerir a melhor ordem, montar workflows).
4. Notificação visual quando chega uma resposta do agente.

## Arquitetura (existente)
- Frontend vanilla JS/HTML/CSS (SIGNALIS-OS shell + terminal).
- Backend HTTP customizado em Python (`server.py`, ThreadingHTTPServer).
- Agente ARIS-9 com padrão ReAct textual em `js/agent.js`.
- Ferramentas registradas em `window.toolManager`.

## O que foi implementado nesta sessão (jan/2026)
- **Sistema de notificações** (`js/notifications.js` + `#notification-container` em `index.html` + estilos em `css/style.css`):
  - Toast centralizado no topo, com borda por tipo (success/warn/error/info), botão de fechar e auto-dismiss em 5,2s.
  - Notification API nativa do navegador — permissão pedida silenciosamente na 1ª mensagem do usuário; só dispara com aba em segundo plano.
  - Beep discreto via Web Audio API (timbre "console retro") com preferências persistidas em localStorage.
- **Correção de CSS quebrado** em `.t-code-italic` (regra aninhada inválida).
- **Novo system prompt do ARIS-9** (`_buildSystemPrompt()`):
  - Protocolo ReAct preservado (ACTION/ARGS) e catálogo Spotify.
  - Seção 1: raciocínio causal + pedido de confirmação para ações irreversíveis.
  - Seção 2: leitura de tom (urgente/curioso/operacional/dúvida/desabafo) → adapta o formato da resposta.
  - Seção 3: otimização proativa de fluxos (ordem, gargalos, atalhos de 1 passo, sugestão de próximo passo em tarefas complexas).
  - Seção 4: estilo SIGNALIS-OS (frio, direto, sem exposição de raciocínio interno).
- **Terminal** (`js/terminal.js`):
  - Notificação disparada em toda `resposta` final (não em ações intermediárias).
  - Helper `_notifyAgentResponse()` escolhe o tipo (success/warn/error/info) pelo conteúdo da resposta.
  - Permissão nativa solicitada silenciosamente na 1ª submissão real do usuário.

## Backlog / Próximos passos
- P1: comando `.notify [on|off|sound|native]` para controlar preferências pelo terminal.
- P2: extrair notificações e renderização de resposta do agente para módulos próprios (`js/terminal.js` está grande).
- P2: camada estruturada de classificação de intenção (hoje é 100% via prompt).

## Testes
- Sintaxe JS: OK em `notifications.js`, `agent.js`, `terminal.js`.
- Testes do repositório (`/app/tests/*.test.js`): já quebrados no baseline pré-mudanças — não é regressão introduzida.
- Verificação visual: toasts renderizando centralizados no topo com bordas coloridas por tipo.
