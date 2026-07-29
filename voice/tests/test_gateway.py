from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator

from fastapi.testclient import TestClient

from voice.stella_voice.agent import AgentReply
from voice.stella_voice.gateway_app import create_voice_app
from voice.stella_voice.metrics import MemoryMetrics
from voice.stella_voice.services import GatewayServices
from voice.stella_voice.tokens import sign_token

SECRET = "0123456789abcdef0123456789abcdef"
SUMMARY = "Good news. Stella found £4,990 per year."


def energy_classifier(frame: bytes, _sample_rate: int) -> bool:
    return any(frame)


class FakeTranscriber:
    async def transcribe(self, frames: AsyncIterator[bytes], on_partial) -> str:
        count = 0
        async for _frame in frames:
            count += 1
        assert count >= 31
        await on_partial("Souls Food UK")
        return "Souls Food UK E4 6SY"


class FakeAgent:
    async def respond(self, text: str, _history: list[dict[str, str]]) -> AgentReply:
        assert text in {"Souls Food UK E4 6SY", "Souls Food UK at E4 6SY"}
        return AgentReply(SUMMARY, tool="lookup_business", outcome="found")


class FakeSynthesizer:
    async def stream(self, text: str) -> AsyncIterator[bytes]:
        assert text == SUMMARY
        yield b"\x00\x00" * 320


class SlowSynthesizer:
    async def stream(self, _text: str) -> AsyncIterator[bytes]:
        yield b"\x00\x00" * 320
        await asyncio.sleep(1)
        yield b"\x00\x00" * 320


def token(jti: str) -> str:
    return sign_token(SECRET, now=1_700_000_000, jti=jti)


def receive_until(socket, terminal: str) -> list[dict]:
    events: list[dict] = []
    while True:
        message = socket.receive()
        if message.get("text"):
            event = json.loads(message["text"])
            events.append(event)
            if event["type"] == terminal:
                return events
        elif message.get("bytes") is not None:
            events.append({"type": "audio_bytes", "length": len(message["bytes"])})


def test_complete_mocked_websocket_audio_turn() -> None:
    metrics = MemoryMetrics()
    app = create_voice_app(
        GatewayServices(FakeTranscriber(), FakeAgent(), FakeSynthesizer()),
        SECRET,
        metrics=metrics,
        classifier=energy_classifier,
        now=lambda: 1_700_000_001,
    )
    speech = b"\x01\x00" * 320
    silence = bytes(640)
    with TestClient(app).websocket_connect(f"/ws?token={token('complete-turn')}") as socket:
        assert socket.receive_json()["type"] == "ready"
        socket.send_bytes(speech)
        for _ in range(30):
            socket.send_bytes(silence)
        events = receive_until(socket, "turn_end")

    types = [event["type"] for event in events]
    assert "speech_started" in types
    assert "transcript_partial" in types
    assert "transcript_final" in types
    assert "audio_bytes" in types
    assert next(event["text"] for event in events if event["type"] == "reply_text") == SUMMARY
    assert all("text" not in record and "transcript" not in record and "audio" not in record for record in metrics.records)


def test_interruption_cancels_playback_within_250ms() -> None:
    metrics = MemoryMetrics()
    app = create_voice_app(
        GatewayServices(FakeTranscriber(), FakeAgent(), SlowSynthesizer()),
        SECRET,
        metrics=metrics,
        classifier=energy_classifier,
        now=lambda: 1_700_000_001,
    )
    with TestClient(app).websocket_connect(f"/ws?token={token('interrupt-turn')}") as socket:
        assert socket.receive_json()["type"] == "ready"
        socket.send_text(json.dumps({"type": "text_input", "text": "Souls Food UK at E4 6SY"}))
        receive_until(socket, "audio_start")
        assert socket.receive()["bytes"]
        started = time.perf_counter()
        socket.send_bytes(b"\x01\x00" * 320)
        events = receive_until(socket, "playback_cancel")
        elapsed = time.perf_counter() - started
        assert events[-1]["reason"] == "user_speech"
        assert elapsed < 0.25
