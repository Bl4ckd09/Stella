from __future__ import annotations

import hashlib
import hmac

import httpx

from .tokens import TokenClaims


class SessionSecurityError(RuntimeError):
    pass


def session_token_hash(secret: str, token_id: str) -> str:
    return hmac.new(secret.encode(), f"jti:{token_id}".encode(), hashlib.sha256).hexdigest()


class SupabaseSessionRedeemer:
    def __init__(
        self,
        supabase_url: str,
        service_role_key: str,
        session_secret: str,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not supabase_url or not service_role_key or len(session_secret) < 32:
            raise ValueError("Supabase voice security settings are required")
        self.endpoint = f"{supabase_url.rstrip('/')}/rest/v1/rpc/redeem_voice_session"
        self.session_secret = session_secret
        self.headers = {
            "apikey": service_role_key,
            "authorization": f"Bearer {service_role_key}",
            "content-type": "application/json",
        }
        self.client = client or httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=3.0))

    async def consume(self, claims: TokenClaims, _now: int | None = None) -> bool:
        try:
            response = await self.client.post(
                self.endpoint,
                headers=self.headers,
                json={"p_jti_hash": session_token_hash(self.session_secret, claims.jti)},
            )
            response.raise_for_status()
            result = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SessionSecurityError("voice_security_unavailable") from exc
        if not isinstance(result, bool):
            raise SessionSecurityError("voice_security_unavailable")
        return result
