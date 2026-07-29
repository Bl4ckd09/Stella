from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from dataclasses import dataclass

AUDIENCE = "stella-voxtral-gateway"


class TokenError(ValueError):
    pass


@dataclass(frozen=True)
class TokenClaims:
    aud: str
    exp: int
    iat: int
    jti: str
    v: int


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc:
        raise TokenError("invalid_voice_token") from exc


def _signature(payload: str, secret: str) -> str:
    digest = hmac.new(secret.encode(), f"v1.{payload}".encode(), hashlib.sha256).digest()
    return _encode(digest)


def sign_token(secret: str, now: int | None = None, ttl: int = 60, jti: str | None = None) -> str:
    if len(secret) < 32:
        raise TokenError("weak_voice_secret")
    issued = int(time.time() if now is None else now)
    claims = {
        "aud": AUDIENCE,
        "exp": issued + ttl,
        "iat": issued,
        "jti": jti or str(uuid.uuid4()),
        "v": 1,
    }
    payload = _encode(json.dumps(claims, separators=(",", ":")).encode())
    return f"v1.{payload}.{_signature(payload, secret)}"


def verify_token(token: str, secret: str, now: int | None = None) -> TokenClaims:
    try:
        version, payload, supplied = token.split(".")
    except ValueError as exc:
        raise TokenError("invalid_voice_token") from exc
    if version != "v1" or not hmac.compare_digest(_signature(payload, secret), supplied):
        raise TokenError("invalid_voice_token")
    try:
        raw = json.loads(_decode(payload))
        claims = TokenClaims(**raw)
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise TokenError("invalid_voice_token") from exc
    current = int(time.time() if now is None else now)
    if claims.v != 1 or claims.aud != AUDIENCE or not claims.jti or len(claims.jti) > 64:
        raise TokenError("invalid_voice_token")
    if claims.iat > current + 5 or claims.exp <= current or claims.exp - claims.iat > 300:
        raise TokenError("expired_voice_token")
    return claims


class ReplayGuard:
    def __init__(self) -> None:
        self._seen: dict[str, int] = {}

    def consume(self, claims: TokenClaims, now: int | None = None) -> bool:
        current = int(time.time() if now is None else now)
        self._seen = {key: expiry for key, expiry in self._seen.items() if expiry > current}
        if claims.jti in self._seen:
            return False
        self._seen[claims.jti] = claims.exp
        return True
