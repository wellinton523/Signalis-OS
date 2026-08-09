# Credenciais de teste do SIGNALIS-OS

- **URL local**: http://localhost:8000/
- **Usuário**: `Nyx`
- **Senha**: `84269713`
- **Nível de permissão**: god (usuário `Nyx` está em `SIGNALIS_GOD_USERS` por padrão)

## Como iniciar o servidor
`cd /app && python3 server.py &` — sobe em `localhost:8000`.

## Notas
- O endpoint `/api/tools` requer o cookie `signalis_session` obtido via `/api/auth`.
- O agente ARIS-9 usa Ollama por padrão (endpoint `/api/ollama/chat`), que pode não estar disponível no ambiente de teste. Testes de UI/UX e ferramentas locais podem ser feitos sem Ollama.
