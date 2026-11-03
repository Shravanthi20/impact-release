import base64
import hashlib
import hmac
import json
import time
from typing import Optional

from app.config import settings

AUTH_SECRET = getattr(settings, "auth_secret", "impactrelease-secret-key-32bytes-auth")


def hash_password(password: str) -> str:
    salt = "impactrelease_salt"
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return hmac.compare_digest(hash_password(plain_password), hashed_password)


def create_token(user_id: int, email: str, role: str, name: str, expires_in_sec: int = 86400 * 7) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "name": name,
        "exp": int(time.time()) + expires_in_sec,
    }
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8").rstrip("=")
    signature = hmac.new(AUTH_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{signature}"


def decode_token(token: str) -> Optional[dict]:
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None
        payload_b64, signature = parts
        expected_sig = hmac.new(AUTH_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return None
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        if payload.get("exp") and payload["exp"] < time.time():
            return None
        return payload
    except Exception:
        return None
