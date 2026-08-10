"""Backend tests for SIGNALIS-OS voice endpoints (iteration 4).

Server: /app/server.py (http.server), listening on PORT (default 8000).
Modules covered: /api/auth/login, /api/voice/tts, /api/voice/stt, /api/tools regression.
"""
import os
import re
import json
from pathlib import Path

import pytest
import requests

BASE_URL = f"http://localhost:{os.getenv('PORT', '8000')}"


def _creds():
    p = Path("/app/memory/test_credentials.md")
    if not p.exists():
        pytest.skip("missing /app/memory/test_credentials.md")
    c = p.read_text(encoding="utf-8")
    u = re.search(r"(?im)^\s*(?:[-*]\s*)?(?:\*\*)?usu[aá]rio(?:\*\*)?\s*:\s*`?([^`\s]+)", c)
    s = re.search(r"(?im)^\s*(?:[-*]\s*)?(?:\*\*)?senha(?:\*\*)?\s*:\s*`?([^`\s]+)", c)
    if not u or not s:
        pytest.skip("no credentials found in test_credentials.md")
    return {"username": u.group(1), "password": s.group(1)}


@pytest.fixture(scope="session")
def anon():
    return requests.Session()


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    creds = _creds()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    if r.status_code != 200:
        pytest.fail(f"login failed {r.status_code}: {r.text[:300]}")
    data = r.json()
    assert data["authenticated"] is True
    assert data["username"] == creds["username"]
    assert data["permissionLevel"] == "god"
    assert "signalis_session" in s.cookies.get_dict()
    return s


# ── Auth ──────────────────────────────────────────────────────────
class TestAuth:
    def test_status_unauthenticated(self, anon):
        r = anon.get(f"{BASE_URL}/api/auth/status", timeout=10)
        assert r.status_code == 200
        assert r.json()["authenticated"] is False

    def test_login_invalid(self, anon):
        r = anon.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "x", "password": "y"}, timeout=10)
        assert r.status_code == 401
        assert "Credenciais" in r.text

    def test_status_authenticated(self, client):
        r = client.get(f"{BASE_URL}/api/auth/status", timeout=10)
        assert r.status_code == 200
        assert r.json()["authenticated"] is True


# ── Voice: auth guard ─────────────────────────────────────────────
class TestVoiceAuthGuard:
    def test_tts_requires_auth(self, anon):
        r = anon.post(f"{BASE_URL}/api/voice/tts", json={"text": "oi"}, timeout=20)
        assert r.status_code == 401

    def test_stt_requires_auth(self, anon):
        r = anon.post(f"{BASE_URL}/api/voice/stt", data=b"", timeout=20)
        assert r.status_code == 401


# ── Voice TTS ─────────────────────────────────────────────────────
class TestVoiceTTS:
    def test_tts_returns_mp3(self, client):
        r = client.post(f"{BASE_URL}/api/voice/tts",
                        json={"text": "Olá, sou o ARIS-9.", "voice": "nova"}, timeout=120)
        assert r.status_code == 200, r.text[:400]
        assert r.headers.get("Content-Type") == "audio/mpeg"
        assert len(r.content) > 5000, f"audio too small: {len(r.content)}"
        assert r.content[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3") or r.content[0] == 0xFF

    def test_tts_empty_text_400(self, client):
        r = client.post(f"{BASE_URL}/api/voice/tts", json={"text": "   "}, timeout=30)
        assert r.status_code == 400
        assert "text" in r.text.lower()

    def test_tts_invalid_json_400(self, client):
        r = client.post(f"{BASE_URL}/api/voice/tts", data=b"not-json",
                        headers={"Content-Type": "application/json"}, timeout=30)
        assert r.status_code == 400

    def test_tts_invalid_voice_no_crash(self, client):
        r = client.post(f"{BASE_URL}/api/voice/tts",
                        json={"text": "teste", "voice": "voz_inexistente"}, timeout=60)
        assert r.status_code in (200, 400, 500)
        if r.status_code != 200:
            # must be a readable plain-text error, not an HTML crash page / traceback
            assert "<html" not in r.text.lower()
            assert "Traceback" not in r.text
            assert len(r.text.strip()) > 0


# ── Voice STT ─────────────────────────────────────────────────────
class TestVoiceSTT:
    def test_stt_empty_body_400(self, client):
        r = client.post(f"{BASE_URL}/api/voice/stt", data=b"",
                        headers={"Content-Type": "audio/webm"}, timeout=30)
        assert r.status_code == 400, r.text[:300]
        msg = r.text.lower()
        assert "udio" in msg or "audio" in msg
        assert "traceback" not in msg

    def test_stt_garbage_audio_readable_error(self, client):
        r = client.post(f"{BASE_URL}/api/voice/stt", data=b"\x00\x01garbage-not-audio" * 20,
                        headers={"Content-Type": "audio/webm"}, timeout=90)
        assert r.status_code in (200, 400, 500)
        assert "<html" not in r.text.lower()
        assert "Traceback" not in r.text
        assert len(r.text.strip()) > 0


# ── Regression: existing endpoints ────────────────────────────────
class TestRegression:
    @pytest.mark.parametrize("path", [
        "/api/system/info", "/api/system/cpu", "/api/system/disk", "/api/tools",
    ])
    def test_endpoints_ok(self, client, path):
        r = client.get(f"{BASE_URL}{path}", timeout=20)
        assert r.status_code == 200, r.text[:200]
        assert r.json() is not None

    def test_static_index_and_new_scripts(self, anon):
        r = anon.get(f"{BASE_URL}/index.html", timeout=10)
        assert r.status_code == 200
        for f in ("aris9-enhancements.js", "voice.js", "voice-chat.js"):
            assert f in r.text, f"{f} not referenced in index.html"
            rs = anon.get(f"{BASE_URL}/js/{f}", timeout=10)
            assert rs.status_code == 200
            assert len(rs.text) > 100
