from __future__ import annotations

import asyncio
import base64
import json
import struct
from dataclasses import dataclass
from typing import Any, AsyncIterator, Awaitable, Callable, Protocol
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


class MistralRealtimeTranscriber:
    def __init__(
        self,
        api_key: str,
        model: str = "voxtral-mini-transcribe-realtime-2602",
        target_delay_ms: int = 240,
        client: Any | None = None,
        audio_format: Any | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("MISTRAL_API_KEY is required")
        if client is None or audio_format is None:
            from mistralai.client import Mistral
            from mistralai.client.models import AudioFormat

            client = client or Mistral(api_key=api_key)
            audio_format = audio_format or AudioFormat(encoding="pcm_s16le", sample_rate=16_000)
        self.client = client
        self.audio_format = audio_format
        self.model = model
        self.target_delay_ms = target_delay_ms

    async def transcribe(self, frames: AsyncIterator[bytes], on_partial: PartialCallback) -> str:
        transcript = ""
        async with asyncio.timeout(35):
            events = self.client.audio.realtime.transcribe_stream(
                audio_stream=frames,
                model=self.model,
                audio_format=self.audio_format,
                target_streaming_delay_ms=self.target_delay_ms,
            )
            async for event in events:
                event_name = type(event).__name__
                if event_name == "TranscriptionStreamTextDelta":
                    delta = str(getattr(event, "text", "") or "")
                    if delta:
                        transcript += delta
                        await on_partial(delta)
                elif event_name == "RealtimeTranscriptionError":
                    raise RuntimeError("Mistral realtime transcription failed")
                elif event_name == "TranscriptionStreamDone":
                    break
        return transcript.strip()


def float32_pcm_to_int16(data: bytes) -> bytes:
    usable = len(data) - (len(data) % 4)
    output = bytearray(usable // 2)
    for index, (sample,) in enumerate(struct.iter_unpack("<f", data[:usable])):
        clamped = max(-1.0, min(1.0, float(sample)))
        value = round(clamped * (32_767 if clamped >= 0 else 32_768))
        struct.pack_into("<h", output, index * 2, value)
    return bytes(output)


class MistralSynthesizer:
    def __init__(
        self,
        api_key: str,
        voice_id: str,
        model: str = "voxtral-mini-tts-2603",
        client: Any | None = None,
    ) -> None:
        if not api_key or not voice_id:
            raise ValueError("Mistral TTS settings are required")
        if client is None:
            from mistralai.client import Mistral

            client = Mistral(api_key=api_key)
        self.client = client
        self.voice_id = voice_id
        self.model = model

    async def stream(self, text: str) -> AsyncIterator[bytes]:
        for attempt in range(2):
            emitted = False
            pending = b""
            try:
                response = await self.client.audio.speech.complete_async(
                    model=self.model,
                    input=text[:1_600],
                    voice_id=self.voice_id,
                    response_format="pcm",
                    stream=True,
                    timeout_ms=60_000,
                )
                async with response as event_stream:
                    async for event in event_stream:
                        data = getattr(event, "data", None)
                        if getattr(data, "type", None) != "speech.audio.delta":
                            continue
                        pending += base64.b64decode(getattr(data, "audio_data", ""), validate=True)
                        usable = len(pending) - (len(pending) % 4)
                        if not usable:
                            continue
                        chunk = float32_pcm_to_int16(pending[:usable])
                        pending = pending[usable:]
                        if chunk:
                            emitted = True
                            yield chunk
                return
            except asyncio.CancelledError:
                raise
            except Exception:
                if emitted or attempt == 1:
                    raise
                await asyncio.sleep(0.1)


@dataclass(frozen=True)
class GatewayServices:
    transcriber: Transcriber
    agent: Agent
    synthesizer: Synthesizer
    runtime_mode: str = "self_hosted"
    provider: str = "modal_nebius"
