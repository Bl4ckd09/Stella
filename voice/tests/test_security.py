from __future__ import annotations

import httpx
import pytest

from voice.stella_voice.security import SessionSecurityError, SupabaseSessionRedeemer, session_token_hash
from voice.stella_voice.tokens import TokenClaims

SECRET = "0123456789abcdef0123456789abcdef"
CLAIMS = TokenClaims(aud="stella-voxtral-gateway", exp=1_700_000_060, iat=1_700_000_000, jti="session-one", v=1)


@pytest.mark.asyncio
async def test_supabase_session_redeemer_hashes_and_consumes_once() -> None:
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=True)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    redeemer = SupabaseSessionRedeemer("https://project.supabase.co", "service-key", SECRET, client=client)
    assert await redeemer.consume(CLAIMS)
    assert requests[0].headers["authorization"] == "Bearer service-key"
    assert CLAIMS.jti.encode() not in requests[0].content
    assert session_token_hash(SECRET, CLAIMS.jti).encode() in requests[0].content


@pytest.mark.asyncio
async def test_supabase_session_redeemer_fails_closed() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    redeemer = SupabaseSessionRedeemer("https://project.supabase.co", "service-key", SECRET, client=client)
    with pytest.raises(SessionSecurityError):
        await redeemer.consume(CLAIMS)
