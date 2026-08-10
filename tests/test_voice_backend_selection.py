"""Iteration 7 — tests for the dynamic voice-backend selection fix.

Covers /app/server.py: _pick_voice_backend(), _voice_setup_hint(),
_handle_voice_stt / _handle_voice_tts 503 humanized errors and the
X-Voice-Backend response header.

These tests are DESTRUCTIVE: they rewrite /app/.env and restart the server.
The env_restore fixture always restores the original .env + restarts.
"""
import os
import re
import json
import time
import shutil
import signal
import subprocess
from pathlib import Path

import pytest
import requests

BASE_URL = f"http://localhost:{os.getenv('PORT', '8000')}"
ENV = Path("/app/.env")
BAK = Path("/tmp/env.bak")
ORIGINAL = ENV.read_text(encoding="utf-8")


def _creds():
    c = Path("/app/memory/test_credentials.md").read_text(encoding="utf-8")
    u = re.search(r"(?im)^\s*(?:[-*]\s*)?(?:\*\*)?usu[aá]rio(?:\*\*)?\s*:\s*`?([^`\s]+)", c)
    s = re.search(r"(?im)^\s*(?:[-*]\s*)?(?:\*\*)?senha(?:\*\*)?\s*:\s*`?([^`\s]+)", c)
    if not u or not s:
        pytest.skip("credentials not found")
    return {"username": u.group(1), "password": s.group(1)}


def _kill_server():
    subprocess.run(["pkill", "-f", "python3 /app/server.py"], check=False)
    subprocess.run(["pkill", "-f", "server.py"], check=False)
    time.sleep(1.5)


def _start_server():
    subprocess.Popen(
        "cd /app && nohup python3 server.py > /tmp/srv_test.log 2>&1 &",
        shell=True, start_new_session=True,
    )
    for _ in range(40):
        try:
            requests.get(f"{BASE_URL}/api/auth/status", timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def _restart():
    _kill_server()
    assert _start_server(), "server did not come back up"


def _write_env(**overrides):
    lines = [l for l in ORIGINAL.splitlines()
             if l.split("=")[0].strip() not in overrides]
    for k, v in overrides.items():
        lines.append(f"{k}={v}")
    ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _login():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=_creds(), timeout=15)
    assert r.status_code == 200, r.text[:300]
    assert "signalis_session" in s.cookies.get_dict()
    return s


@pytest.fixture(scope="module", autouse=True)
def env_restore():
    if not BAK.exists():
        shutil.copy(ENV, BAK)
    yield
    ENV.write_text(ORIGINAL, encoding="utf-8")
    _restart()
    # sanity: keys back
    assert "EMERGENT_LLM_KEY=sk-" in ENV.read_text(encoding="utf-8")


# ── 1. Current pod env: both libs + EMERGENT_LLM_KEY → emergent backend ──
class TestCurrentEnvironment:
    def test_tts_uses_emergent_backend(self):
        _write_env()  # original content
        _restart()
        s = _login()
        r = s.post(f"{BASE_URL}/api/voice/tts",
                   json={"text": "oi", "voice": "nova"}, timeout=120)
        assert r.status_code == 200, r.text[:400]
        assert r.headers.get("Content-Type") == "audio/mpeg"
        assert r.headers.get("X-Voice-Backend") == "emergent", dict(r.headers)
        assert len(r.content) > 5000, f"audio too small: {len(r.content)}"


# ── 2 & 3. No keys at all → humanized 503 mentioning BOTH key names ──
class TestNoKeys503:
    @pytest.fixture(scope="class", autouse=True)
    def no_keys(self):
        _write_env(EMERGENT_LLM_KEY="", OPENAI_API_KEY="")
        _restart()
        yield

    def test_tts_503_mentions_both_keys(self):
        s = _login()
        r = s.post(f"{BASE_URL}/api/voice/tts",
                   json={"text": "oi", "voice": "nova"}, timeout=60)
        assert r.status_code == 503, f"{r.status_code}: {r.text[:300]}"
        data = r.json()
        err = data["error"]
        assert "OPENAI_API_KEY" in err, err
        assert "EMERGENT_LLM_KEY" in err, err
        assert err.strip() != "EMERGENT_LLM_KEY não configurada"
        assert len(err) > 40, err

    def test_stt_503_mentions_both_keys(self):
        s = _login()
        r = s.post(f"{BASE_URL}/api/voice/stt", data=b"\x00\x01fake-audio" * 10,
                   headers={"Content-Type": "audio/webm"}, timeout=60)
        assert r.status_code == 503, f"{r.status_code}: {r.text[:300]}"
        err = r.json()["error"]
        assert "OPENAI_API_KEY" in err, err
        assert "EMERGENT_LLM_KEY" in err, err


# ── 4. In-process: no lib + no key → hint has install instructions ──
class TestInProcessHints:
    def test_no_lib_no_key_hint(self):
        code = (
            "import sys, os; sys.path.insert(0,'/app');\n"
            "import server;\n"
            "server._HAS_EMERGENT=False; server._HAS_OPENAI=False;\n"
            "os.environ['EMERGENT_LLM_KEY']=''; os.environ['OPENAI_API_KEY']='';\n"
            "b,k = server._pick_voice_backend();\n"
            "print('BACKEND=%r' % b); print('HINT=' + server._voice_setup_hint())"
        )
        p = subprocess.run(["python3", "-c", code], capture_output=True, text=True, timeout=120)
        out = p.stdout
        assert p.returncode == 0, p.stderr[-800:]
        assert "BACKEND=None" in out, out
        assert ("pip install openai" in out) or ("pip install emergentintegrations" in out), out
        assert "OPENAI_API_KEY" in out, out

    def test_emergent_lib_only_without_key_falls_through(self):
        code = (
            "import sys, os; sys.path.insert(0,'/app');\n"
            "import server;\n"
            "server._HAS_EMERGENT=True; server._HAS_OPENAI=False;\n"
            "os.environ['EMERGENT_LLM_KEY']=''; os.environ['OPENAI_API_KEY']='';\n"
            "b,k = server._pick_voice_backend();\n"
            "print('BACKEND=%r' % b); print('HINT=' + server._voice_setup_hint())"
        )
        p = subprocess.run(["python3", "-c", code], capture_output=True, text=True, timeout=120)
        assert p.returncode == 0, p.stderr[-800:]
        assert "BACKEND=None" in p.stdout, p.stdout
        assert "OPENAI_API_KEY" in p.stdout, p.stdout

    def test_openai_key_only_picks_openai(self):
        code = (
            "import sys, os; sys.path.insert(0,'/app');\n"
            "import server;\n"
            "os.environ['EMERGENT_LLM_KEY']=''; os.environ['OPENAI_API_KEY']='sk-fake';\n"
            "print('BACKEND=%r' % (server._pick_voice_backend(),))"
        )
        p = subprocess.run(["python3", "-c", code], capture_output=True, text=True, timeout=120)
        assert p.returncode == 0, p.stderr[-800:]
        assert "BACKEND=('openai', 'sk-fake')" in p.stdout, p.stdout


# ── 5. Only OPENAI_API_KEY (fake) → must TRY openai, not 503 ──
class TestOpenAIOnly:
    @pytest.fixture(scope="class", autouse=True)
    def openai_only(self):
        _write_env(EMERGENT_LLM_KEY="", OPENAI_API_KEY="sk-openai-fake-test-key")
        _restart()
        yield

    def test_tts_attempts_openai_backend(self):
        s = _login()
        r = s.post(f"{BASE_URL}/api/voice/tts",
                   json={"text": "oi", "voice": "nova"}, timeout=90)
        assert r.status_code != 503, f"should not be 503: {r.text[:300]}"
        assert r.status_code == 500, f"{r.status_code}: {r.text[:300]}"
        err = r.json()["error"]
        assert "openai" in err.lower(), err
        assert "Traceback" not in err

    def test_stt_attempts_openai_backend(self):
        s = _login()
        r = s.post(f"{BASE_URL}/api/voice/stt", data=b"\x00\x01fake-audio" * 10,
                   headers={"Content-Type": "audio/webm"}, timeout=90)
        assert r.status_code != 503, f"should not be 503: {r.text[:300]}"
        assert r.status_code == 500, f"{r.status_code}: {r.text[:300]}"
        err = r.json()["error"]
        assert "openai" in err.lower(), err


# ── 6. General regression after env restore ──
class TestRegressionAfterRestore:
    def test_regression_endpoints(self):
        _write_env()
        _restart()
        s = _login()
        r = s.get(f"{BASE_URL}/api/tools", timeout=20)
        assert r.status_code == 200, r.text[:200]
        body = r.json()
        assert body is not None
        assert "_id" not in json.dumps(body)

        rs = s.get(f"{BASE_URL}/api/system/info", timeout=20)
        assert rs.status_code == 200

        # TTS works again with restored key
        rt = s.post(f"{BASE_URL}/api/voice/tts", json={"text": "teste", "voice": "nova"}, timeout=120)
        assert rt.status_code == 200, rt.text[:300]
        assert rt.headers.get("X-Voice-Backend") == "emergent"
