# Credenciais do SIGNALIS-OS

- URL local: http://localhost:8000/
- Usuário: `Nyx`
- Senha: `84269713`
- Nível: `god` (SIGNALIS_GOD_USERS)
- Servidor: `cd /app && python3 server.py &` (porta 8000)
- Login endpoint: `POST /api/auth/login` com JSON `{username, password}` — cookie `signalis_session`

## Emergent LLM key
- Em `/app/.env` como `EMERGENT_LLM_KEY=sk-emergent-534De521b39A46a36E`.
- Usada por `/api/voice/tts` (OpenAI TTS-1-HD) e `/api/voice/stt` (Whisper-1).
