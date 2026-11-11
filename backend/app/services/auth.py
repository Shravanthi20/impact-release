import base64
import hashlib
import hmac
import json
import time
from typing import Optional

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session

from app.config import settings
from app.db.models import User
from app.db.session import get_session

AUTH_SECRET = getattr(settings, "auth_secret", "impactrelease-secret-key-32bytes-auth")


def hash_password(password: str) -> str:
    salt = "impactrelease_salt"
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def verify_password(plain_password: str, hashed_password: str | None) -> bool:
    if not hashed_password:
        return False
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


def get_current_user(
    authorization: str | None = Header(None), session: Session = Depends(get_session)
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required (missing Bearer token)")
    raw_token = authorization.split("Bearer ", 1)[1].strip()
    payload = decode_token(raw_token)
    if not payload:
        raise HTTPException(status_code=401, detail="Expired or invalid session token")
    user = session.get(User, payload["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def require_role(*allowed_roles: str):
    def _role_checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Forbidden: role '{user.role}' does not have permission (requires one of {allowed_roles})",
            )
        return user

    return _role_checker
