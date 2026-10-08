import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_env():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY") if not os.environ.get(k)]
    if missing:
        raise SystemExit(f".env에 없음: {', '.join(missing)}")


def service_client():
    from supabase import create_client

    load_env()
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])


def anon_config():
    """config.js에서 URL과 anon 키를 읽는다(테스트용)."""
    import re
    text = (ROOT / "config.js").read_text(encoding="utf-8")
    url = re.search(r'SUPABASE_URL\s*=\s*"([^"]+)"', text).group(1)
    key = re.search(r'SUPABASE_ANON_KEY\s*=\s*"([^"]+)"', text).group(1)
    return url, key
