from __future__ import annotations

import argparse
import asyncio
import json
import time
from urllib.parse import urlparse, urlunparse

import httpx
import websockets


def websocket_endpoint(base_url: str) -> str:
    parsed = urlparse(base_url)
    scheme = "wss" if parsed.scheme in ("https", "wss") else "ws"
    path = parsed.path if parsed.path not in ("", "/") else "/ws"
    return urlunparse((scheme, parsed.netloc, path, "", "", ""))


async def session(app_url: str) -> dict:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            f"{app_url.rstrip('/')}/api/voice/session",
            headers={"Origin": app_url.rstrip("/")},
        )
        response.raise_for_status()
        return response.json()


async def smoke(app_url: str, text: str, expected: str) -> None:
    voice_session = await session(app_url)
    endpoint = websocket_endpoint(voice_session["gateway_url"])
    sent_at = time.perf_counter()
    first_audio_at = None
    reply = None
    async with websockets.connect(endpoint, origin=app_url.rstrip("/")) as socket:
        await socket.send(json.dumps({"type": "auth", "token": voice_session["token"]}))
        ready = json.loads(await socket.recv())
        if ready.get("type") != "ready":
            raise RuntimeError("Gateway did not become ready")
        sent_at = time.perf_counter()
        await socket.send(json.dumps({"type": "text_input", "text": text}))
        while True:
            message = await asyncio.wait_for(socket.recv(), timeout=60)
            if isinstance(message, bytes):
                first_audio_at = first_audio_at or time.perf_counter()
                continue
            event = json.loads(message)
            if event.get("type") == "reply_text":
                reply = event.get("text")
            if event.get("type") == "turn_end":
                break
            if event.get("type") == "error":
                raise RuntimeError(event.get("message") or "Gateway error")
    if expected not in (reply or ""):
        raise RuntimeError(f"Reply did not contain expected text: {expected}")
    if first_audio_at is None:
        raise RuntimeError("Gateway returned no audio")
    latency = first_audio_at - sent_at
    if latency >= 2:
        raise RuntimeError(f"First reply audio took {latency:.3f}s")
    print(json.dumps({"status": "ok", "first_audio_ms": round(latency * 1000, 1), "query": text}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test the deployed Stella text fallback and TTS turn.")
    parser.add_argument("--app-url", required=True)
    parser.add_argument("--text", default="Souls Food UK at E4 6SY")
    parser.add_argument("--expect", default="£")
    args = parser.parse_args()
    asyncio.run(smoke(args.app_url, args.text, args.expect))
