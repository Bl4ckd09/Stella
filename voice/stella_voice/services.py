from __future__ import annotations

import asyncio
import base64
import json
from dataclasses import dataclass
from typing import AsyncIterator, Awaitable, Callable, Protocol
from urllib.parse import urlparse, urlunparse

import httpx
import websockets

from .agent import AgentReply

PartialCallback = Callable[[str], Awaitable[None]]


class Transcriber(Protocol):
    async def transcribe(self, frames: AsyncIterator[bytes], on_partial: PartialCallback) -> str: ...


class Agent(Protocol):
    async def respond(self, text: str, history: list[dict[str, str]]) -> AgentReply: ...


class Synthesizer(Protocol):
    def stream(self, text: str) -> AsyncIterator[bytes]: ...


def proxy_headers(key: str | None, secret: str | None) -> dict[str, str]:
    if not key or not secret:
        return {}
    return {"Modal-Key": key, "Modal-Secret": secret}


def websocket_url(base_url: str, path: str) -> str:
    parsed = urlparse(base_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return urlunparse((scheme, parsed.netloc, path, "", "", ""))


class VoxtralRealtimeTranscriber:
    def __init__(
        self,
        base_url: str,
        modal_key: str | None = None,
        modal_secret: str | None = None,
        model: str = "mistralai/Voxtral-Mini-4B-Realtime-2602",
    ) -> None:
        self.endpoint = websocket_url(base_url, "/v1/realtime")
        self.headers = proxy_headers(modal_key, modal_secret)
        self.model = model

    async def transcribe(self, frames: AsyncIterator[bytes], on_partial: PartialCallback) -> str:
        async with websockets.connect(
            self.endpoint,
            additional_headers=self.headers,
            max_size=2 * 1024 * 1024,
            open_timeout=30,
        ) as socket:
            created = json.loads(await asyncio.wait_for(socket.recv(), timeout=20))
            if created.get("type") != "session.created":
                raise RuntimeError("Voxtral did not create a realtime session")
            await socket.send(json.dumps({"type": "session.update", "model": self.model}))
            await socket.send(json.dumps({"type": "input_audio_buffer.commit"}))

            async def send_audio() -> None:
                async for frame in frames:
                    await socket.send(json.dumps({
                        "type": "input_audio_buffer.append",
                        "audio": base64.b64encode(frame).decode("ascii"),
                    }))
                await socket.send(json.dumps({"type": "input_audio_buffer.commit", "final": True}))

            sender = asyncio.create_task(send_audio())
            try:
                while True:
                    event = json.loads(await asyncio.wait_for(socket.recv(), timeout=30))
                    if event.get("type") == "transcription.delta":
                        await on_partial(str(event.get("delta") or ""))
                    elif event.get("type") == "transcription.done":
                        await sender
                        return str(event.get("text") or "").strip()
                    elif event.get("type") == "error":
                        raise RuntimeError("Voxtral transcription failed")
            finally:
                if not sender.done():
                    sender.cancel()


class VoxtralSynthesizer:
    def __init__(
        self,
        base_url: str,
        modal_key: str | None = None,
        modal_secret: str | None = None,
        voice: str = "casual_female",
        model: str = "mistralai/Voxtral-4B-TTS-2603",
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.endpoint = f"{base_url.rstrip('/')}/v1/audio/speech"
        self.headers = {"Content-Type": "application/json", **proxy_headers(modal_key, modal_secret)}
        self.voice = voice
        self.model = model
        self.client = client or httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=30.0))

    async def stream(self, text: str) -> AsyncIterator[bytes]:
        pending = b""
        async with self.client.stream(
            "POST",
            self.endpoint,
            headers=self.headers,
            json={
                "input": text,
                "model": self.model,
                "voice": self.voice,
                "response_format": "pcm",
                "stream": True,
                "stream_format": "audio",
            },
        ) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes(12_000):
                pending += chunk
                even_length = len(pending) - (len(pending) % 2)
                if even_length:
                    yield pending[:even_length]
                    pending = pending[even_length:]


@dataclass(frozen=True)
class GatewayServices:
    transcriber: Transcriber
    agent: Agent
    synthesizer: Synthesizer
