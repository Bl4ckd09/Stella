from voice.stella_voice.tokens import ReplayGuard, TokenError, sign_token, verify_token

SECRET = "0123456789abcdef0123456789abcdef"
TOKEN_VECTOR = "v1.eyJhdWQiOiJzdGVsbGEtdm94dHJhbC1nYXRld2F5IiwiZXhwIjoxNzAwMDAwMDYwLCJpYXQiOjE3MDAwMDAwMDAsImp0aSI6InRlc3Qtc2Vzc2lvbiIsInYiOjF9.aMMZotf06Pfw-p9TE2oo7RDxp69zQp-Yx0njZ1rRIQI"


def test_token_round_trip_and_expiry() -> None:
    token = sign_token(SECRET, now=1_700_000_000, ttl=60, jti="test-session")
    assert token == TOKEN_VECTOR
    claims = verify_token(token, SECRET, now=1_700_000_030)
    assert claims.jti == "test-session"
    assert claims.exp == 1_700_000_060
    try:
        verify_token(token, SECRET, now=1_700_000_061)
        raise AssertionError("expired token was accepted")
    except TokenError as exc:
        assert str(exc) == "expired_voice_token"


def test_token_signature_and_replay() -> None:
    token = sign_token(SECRET, now=1_700_000_000, jti="single-use")
    claims = verify_token(token, SECRET, now=1_700_000_001)
    guard = ReplayGuard()
    assert guard.consume(claims, now=1_700_000_001)
    assert not guard.consume(claims, now=1_700_000_002)
    try:
        verify_token(token[:-1] + "A", SECRET, now=1_700_000_001)
        raise AssertionError("modified token was accepted")
    except TokenError:
        pass
