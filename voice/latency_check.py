from __future__ import annotations

import argparse
import asyncio
import json
import math
import time
import wave

import websockets

from voice.smoke_deployed import session, websocket_endpoint


def load_pcm(path: str) -> list[bytes]:
    with wave.open(path, "rb") as source:
        if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getframerate() != 16_000:
            raise ValueError("The WAV file must contain mono PCM16 audio at 16 kHz")
        pcm = source.readframes(source.getnframes())
    frame_bytes = 640
    frames = [pcm[index:index + frame_bytes] for index in range(0, len(pcm), frame_bytes)]
    if frames and len(frames[-1]) < frame_bytes:
        frames[-1] += bytes(frame_bytes - len(frames[-1]))
    return frames


async def run_once(app_url: str, frames: list[bytes]) -> tuple[float, float]:
    voice_session = await session(app_url)
    endpoint = websocket_endpoint(voice_session["gateway_url"], voice_session["token"])
    speech_started_at = None
    endpoint_at = None
    partial_at = None
    first_audio_at = None

    async with websockets.connect(endpoint, origin=app_url.rstrip("/")) as socket:
        if json.loads(await socket.recv()).get("type") != "ready":
            raise RuntimeError("Gateway did not become ready")

        async def sender() -> None:
            nonlocal speech_started_at
            for frame in frames:
                if speech_started_at is None and any(frame):
                    speech_started_at = time.perf_counter()
                await socket.send(frame)
                await asyncio.sleep(0.02)
            for _ in range(30):
                await socket.send(bytes(640))
                await asyncio.sleep(0.02)

        send_task = asyncio.create_task(sender())
        while True:
            message = await asyncio.wait_for(socket.recv(), timeout=60)
            if isinstance(message, bytes):
                first_audio_at = first_audio_at or time.perf_counter()
                continue
            event = json.loads(message)
            if event.get("type") == "transcript_partial":
                partial_at = partial_at or time.perf_counter()
            elif event.get("type") == "speech_ended":
                endpoint_at = time.perf_counter()
            elif event.get("type") == "error":
                raise RuntimeError(event.get("message") or "Gateway error")
            elif event.get("type") == "turn_end":
                break
        await send_task

    if speech_started_at is None or partial_at is None or endpoint_at is None or first_audio_at is None:
        raise RuntimeError("The gateway omitted a required latency event")
    return (partial_at - speech_started_at) * 1000, (first_audio_at - endpoint_at) * 1000


def p95(values: list[float]) -> float:
    return sorted(values)[max(0, math.ceil(len(values) * 0.95) - 1)]


async def check(app_url: str, wav_path: str, runs: int) -> None:
    frames = load_pcm(wav_path)
    partials: list[float] = []
    replies: list[float] = []
    for _ in range(runs):
        partial, reply = await run_once(app_url, frames)
        partials.append(partial)
        replies.append(reply)
    result = {
        "runs": runs,
        "partial_p95_ms": round(p95(partials), 1),
        "first_audio_p95_ms": round(p95(replies), 1),
    }
    print(json.dumps(result))
    if result["partial_p95_ms"] >= 800:
        raise RuntimeError("Warm P95 partial transcription exceeded 800 ms")
    if result["first_audio_p95_ms"] >= 2_000:
        raise RuntimeError("First reply audio exceeded two seconds after turn end")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Measure deployed Stella voice latency.")
    parser.add_argument("--app-url", required=True)
    parser.add_argument("--wav", required=True, help="A mono PCM16 16 kHz WAV query")
    parser.add_argument("--runs", type=int, default=5)
    args = parser.parse_args()
    asyncio.run(check(args.app_url, args.wav, args.runs))
