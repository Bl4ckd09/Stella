from __future__ import annotations

import base64
import struct
from collections.abc import AsyncIterator
from types import SimpleNamespace

import pytest

from voice.stella_voice.services import MistralRealtimeTranscriber, MistralSynthesizer, float32_pcm_to_int16


class FakeRealtime:
    async def transcribe_stream(self, **_kwargs):
        yield SimpleNamespace(__class__=SimpleNamespace(__name__="ignored"))


class TextDelta:
    def __init__(self, text: str) -> None:
        self.text = text


TextDelta.__name__ = "TranscriptionStreamTextDelta"


class Done:
    pass


Done.__name__ = "TranscriptionStreamDone"


class RealtimeEvents:
    async def transcribe_stream(self, **kwargs):
        frames = [frame async for frame in kwargs["audio_stream"]]
        assert frames == [b"audio"]
        yield TextDelta("Souls ")
        yield TextDelta("Food UK")
        yield Done()


class AsyncEventStream:
    def __init__(self, events: list[object]) -> None:
        self.events = events

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def __aiter__(self):
        return self._events()

    async def _events(self):
        for event in self.events:
            yield event


class FakeSpeech:
    async def complete_async(self, **kwargs):
        assert kwargs["response_format"] == "pcm"
        raw = struct.pack("<fff", -1.0, 0.0, 1.0)
        data = SimpleNamespace(type="speech.audio.delta", audio_data=base64.b64encode(raw).decode())
        return AsyncEventStream([SimpleNamespace(data=data)])


async def frame_source() -> AsyncIterator[bytes]:
    yield b"audio"


@pytest.mark.asyncio
async def test_mistral_realtime_transcriber_streams_partials() -> None:
    client = SimpleNamespace(audio=SimpleNamespace(realtime=RealtimeEvents()))
    transcriber = MistralRealtimeTranscriber("key", client=client, audio_format={"sample_rate": 16_000})
    partials: list[str] = []

    async def on_partial(text: str) -> None:
        partials.append(text)

    assert await transcriber.transcribe(frame_source(), on_partial) == "Souls Food UK"
    assert partials == ["Souls ", "Food UK"]


@pytest.mark.asyncio
async def test_mistral_tts_converts_float_pcm_to_browser_pcm16() -> None:
    client = SimpleNamespace(audio=SimpleNamespace(speech=FakeSpeech()))
    synthesizer = MistralSynthesizer("key", "voice", client=client)
    chunks = [chunk async for chunk in synthesizer.stream("Hello")]
    assert struct.unpack("<hhh", b"".join(chunks)) == (-32768, 0, 32767)
    assert float32_pcm_to_int16(struct.pack("<f", 2.0)) == struct.pack("<h", 32767)
